import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { parseFile, commitImport, ValidationError } from '../services/importService.js';
import { suggestMapping } from '../services/importLlmService.js';
import { getOutgoingNames, getIncomingNames } from '../services/categoryService.js';
import { ACCOUNTS } from '../constants/categories.js';

const router = Router();

// multer config scoped to this file only — 10MB memory-buffered upload,
// nothing else in the codebase needs file uploads.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function handleError(res, err) {
  if (err instanceof ValidationError || err.statusCode === 400) {
    return res.status(400).json({ error: err.message });
  }
  if (err.statusCode === 404) {
    return res.status(404).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

router.post('/parse', (req, res) => {
  upload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) {
      // multer surfaces oversized-file / malformed-multipart errors here,
      // before our own handler ever runs — treat as a clean 400.
      return res.status(400).json({ error: uploadErr.message || 'File upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    try {
      const result = parseFile(req.file.buffer);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });
});

// Builds the knownCategories vocabulary the LLM's categoryMapping suggestions
// must stay within (server-injected, not caller-trusted) — every non-system
// outgoing/incoming category across both accounts. The LLM service validates
// against exactly this list; it never sees account-scoping, only name+list,
// matching the categoryMapping contract documented on the team board.
function buildKnownCategories() {
  const known = [];
  for (const accountId of Object.values(ACCOUNTS)) {
    for (const name of getOutgoingNames(accountId)) {
      known.push({ name, list: 'outgoing' });
    }
    for (const name of getIncomingNames(accountId)) {
      known.push({ name, list: 'incoming' });
    }
  }
  // De-dupe identical name+list pairs across accounts (e.g. both accounts
  // happen to have a "food" outgoing category) — the vocabulary only needs
  // to know the name+list is valid somewhere, not which account.
  const seen = new Set();
  return known.filter((entry) => {
    const key = `${entry.list}::${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Deterministic content hash used as the per-file suggestion cache key.
// Hashes headers + sampleRows (not the full file) — re-clicking Suggest with
// the same headers/sample reuses the cached result instead of re-calling the
// LLM. If the caller passes an explicit fileHash, that is preferred (it can
// hash the full uploaded bytes, which is a stronger identity than the
// sample alone); otherwise this is the fallback derivation.
function deriveFileHash({ fileHash, headers, sampleRows }) {
  if (typeof fileHash === 'string' && fileHash.trim()) {
    return fileHash.trim();
  }
  const basis = JSON.stringify({ headers, sampleRows });
  return crypto.createHash('sha256').update(basis).digest('hex');
}

router.post('/suggest', async (req, res) => {
  try {
    const { headers, sampleRows, accountLabels, commentCol, fileHash } = req.body || {};

    if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(sampleRows)) {
      return res.status(400).json({ error: 'headers (non-empty array) and sampleRows (array) are required' });
    }

    const knownCategories = buildKnownCategories();
    const hash = deriveFileHash({ fileHash, headers, sampleRows });

    const suggestion = await suggestMapping({
      headers,
      sampleRows,
      knownCategories,
      accountLabels,
      commentCol,
      fileHash: hash,
    });

    // Never 500 for an expected LLM failure/not-configured case — the
    // client always treats a null suggestion as "no suggestion".
    res.json({ suggestion });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/commit', (req, res) => {
  try {
    const result = commitImport(req.body);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
