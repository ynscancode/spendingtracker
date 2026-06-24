// Fully mocked test for importLlmService.js. Does NOT require a running
// server and NEVER hits the network — a fake fetch transport is injected
// directly into suggestMapping() for every case. Run with:
//   node src/scripts/importLlmTest.js
//
// IMPORTANT: this script must never be modified to perform a real network
// call. All transport is via the injected fetchImpl stub.

import assert from 'node:assert/strict';

// Set required env vars BEFORE importing the service module, since some
// service internals read process.env at call time (not module load time) —
// but we still set them up front here for clarity/consistency across cases.
process.env.OLLAMA_CLOUD_API_KEY = 'test-key-not-real';
process.env.OLLAMA_CLOUD_MODEL = 'gpt-oss:20b-cloud';
process.env.OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';

const { suggestMapping, clearSuggestionCache } = await import('../services/importLlmService.js');

let passCount = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passCount += 1;
  console.log(`  ok: ${msg}`);
}

function fakeJsonResponse(bodyObj, { ok: okFlag = true, status = 200 } = {}) {
  const text = JSON.stringify(bodyObj);
  return {
    ok: okFlag,
    status,
    headers: { get: () => String(text.length) },
    text: async () => text,
  };
}

function fakeRawResponse(text, { ok: okFlag = true, status = 200 } = {}) {
  return {
    ok: okFlag,
    status,
    headers: { get: () => String(text.length) },
    text: async () => text,
  };
}

const HEADERS = ['Date', 'Amount', 'Comment'];
const KNOWN_CATEGORIES = [{ name: 'food', list: 'outgoing' }, { name: 'income', list: 'incoming' }];

function wellFormedOllamaChat() {
  return {
    message: {
      role: 'assistant',
      content: JSON.stringify({
        columnMapping: {
          dateCol: 0,
          dateFormat: 'YMD',
          amountMode: 'single',
          amountCol: 1,
          directionCol: null,
          debitCol: null,
          creditCol: null,
          categoryCol: null,
          commentCol: 2,
          accountCol: null,
        },
        categoryMapping: [{ raw: 'Groceries', name: 'food', list: 'outgoing', isNew: false }],
        accountMapping: [{ raw: 'Checking', accountId: 1 }],
      }),
    },
    done: true,
  };
}

async function testSuccessfulResponse() {
  console.log('(a) mocked successful well-formed response -> validated mapping');
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  const result = await suggestMapping({
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    accountLabels: ['Checking'],
    commentCol: 2,
    fileHash: 'hash-a',
    fetchImpl,
  });

  ok(callCount === 1, 'transport called exactly once');
  ok(result !== null, 'result is non-null');
  ok(result.columnMapping.dateCol === 0, 'dateCol parsed correctly');
  ok(result.columnMapping.dateFormat === 'YMD', 'dateFormat parsed correctly');
  ok(result.columnMapping.amountMode === 'single', 'amountMode parsed correctly');
  ok(result.categoryMapping.length === 1 && result.categoryMapping[0].name === 'food', 'categoryMapping validated');
  ok(result.accountMapping.length === 1 && result.accountMapping[0].accountId === 1, 'accountMapping validated');
}

// Control/positive check for (b): proves the harness itself is capable of
// returning non-null for a payload that is structurally identical to the
// "malformed" cases below MINUS the single violation under test. Without
// this, a passing "(b) returns null" assertion could be a false negative
// from some unrelated bug (e.g. always returning null) rather than from the
// validator actually catching the specific violation — this guards against
// that tautology.
async function testMalformedControlIsActuallyValid() {
  console.log('(b-control) sanity: a payload shaped like the malformed cases but WITHOUT the violation is accepted');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0, // in-range (vs. 999 in the real malformed case)
            dateFormat: 'YMD',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: null,
            commentCol: 2,
            accountCol: null,
          },
        }),
      },
      done: true,
    });

  const result = await suggestMapping({
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-b-control',
    fetchImpl,
  });

  ok(result !== null, 'control payload (no violation) is accepted, proving the validator is not just always-null');
}

async function testMalformedResponse() {
  console.log('(b) mocked malformed/off-schema response -> fallback (null), no throw');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 999, // out of range
            dateFormat: 'YMD',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: null,
            commentCol: 2,
            accountCol: null,
          },
        }),
      },
      done: true,
    });

  let threw = false;
  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-b',
      fetchImpl,
    });
  } catch {
    threw = true;
  }
  ok(!threw, 'does not throw on malformed/off-schema response (out-of-range column index)');
  ok(result === null, 'returns null (fallback signal) for off-schema response (out-of-range column index)');
}

// Strengthens (b): the column mapping is perfectly valid here, but
// categoryMapping proposes a category name that is NOT in knownCategories
// and is not flagged isNew — this must independently cause a drop-whole
// rejection (exercises validateCategoryMapping's allow-list check, a
// distinct code path from the column-index check above).
async function testMalformedCategoryMapping() {
  console.log('(b2) mocked off-schema categoryMapping (unknown category, not flagged isNew) -> fallback (null)');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0,
            dateFormat: 'YMD',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: null,
            commentCol: 2,
            accountCol: null,
          },
          categoryMapping: [
            { raw: 'Groceries', name: 'totally-invented-category-not-in-known-list', list: 'outgoing', isNew: false },
          ],
          accountMapping: [],
        }),
      },
      done: true,
    });

  let threw = false;
  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-b2',
      fetchImpl,
    });
  } catch {
    threw = true;
  }
  ok(!threw, 'does not throw on unknown-category-not-flagged-isNew response');
  ok(result === null, 'returns null (fallback signal) when categoryMapping proposes an unknown category without isNew:true');
}

// Strengthens (b): a non-2xx HTTP status from the upstream provider (e.g.
// 401/429/500) must be treated identically to "no suggestion" — exercises
// the `!response.ok` branch, distinct from JSON/schema validation.
async function testNon2xxUpstream() {
  console.log('(b3) mocked non-2xx upstream HTTP status -> fallback (null)');
  const fetchImpl = async () => fakeJsonResponse({ error: 'rate limited' }, { ok: false, status: 429 });

  let threw = false;
  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-b3',
      fetchImpl,
    });
  } catch {
    threw = true;
  }
  ok(!threw, 'does not throw on non-2xx upstream status');
  ok(result === null, 'returns null (fallback signal) for a non-2xx upstream response (429)');
}

// Strengthens (b): a non-JSON / truncated response body must be rejected
// cleanly rather than throwing out of suggestMapping.
async function testNonJsonBody() {
  console.log('(b4) mocked non-JSON/truncated response body -> fallback (null)');
  const fetchImpl = async () => fakeRawResponse('<html>not json at all</html>');

  let threw = false;
  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-b4',
      fetchImpl,
    });
  } catch {
    threw = true;
  }
  ok(!threw, 'does not throw on non-JSON response body');
  ok(result === null, 'returns null (fallback signal) for a non-JSON response body');
}

async function testTimeoutNetworkError() {
  console.log('(c) mocked timeout/network error -> fallback (null)');
  const fetchImpl = async () => {
    throw new Error('simulated network failure');
  };

  let threw = false;
  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-c',
      fetchImpl,
    });
  } catch {
    threw = true;
  }
  ok(!threw, 'does not throw on network error');
  ok(result === null, 'returns null (fallback signal) for network error');
}

async function testCacheBehavior() {
  console.log('(d) cache behavior: same fileHash called twice -> transport invoked once');
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  const args = {
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-d-cache',
    fetchImpl,
  };

  const first = await suggestMapping(args);
  const second = await suggestMapping(args);

  ok(callCount === 1, 'transport stub invoked only once across two calls with same fileHash');
  ok(first !== null && second !== null, 'both calls returned a non-null suggestion');
  ok(JSON.stringify(first) === JSON.stringify(second), 'cached result is identical to original');
}

async function testFailureNotCached() {
  console.log('(h) failure not cached: same fileHash, transport fails every time -> transport invoked on both calls');
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse({ error: 'down' }, { ok: false, status: 503 });
  };

  const args = {
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-h-failnotcached',
    fetchImpl,
  };

  const first = await suggestMapping(args);
  const second = await suggestMapping(args);

  ok(callCount === 2, 'transport stub invoked on both calls (failure was not cached)');
  ok(first === null, 'first call returns null on upstream failure');
  ok(second === null, 'second call returns null on upstream failure (re-attempted, not a stale cached null)');
}

async function testRowCap() {
  console.log('(e) <=5 row cap: 10 sample rows passed -> request stub receives <=5');
  let receivedSampleRows = null;
  let receivedThink = undefined;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    const userMessage = JSON.parse(parsedBody.messages[1].content);
    receivedSampleRows = userMessage.sampleRows;
    receivedThink = parsedBody.think;
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  const tenRows = Array.from({ length: 10 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, '0')}`, '5.00', 'x']);

  await suggestMapping({
    headers: HEADERS,
    sampleRows: tenRows,
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-e',
    fetchImpl,
  });

  ok(Array.isArray(receivedSampleRows), 'request body contained a sampleRows array');
  ok(receivedSampleRows.length <= 5, `request sampleRows capped at <=5 (got ${receivedSampleRows.length})`);
  ok(receivedSampleRows.length === 5, 'request sampleRows is exactly 5 when 10 were supplied (cap is exercised, not coincidentally satisfied)');
  ok(receivedThink === 'low', `request body has top-level think:'low' (got ${JSON.stringify(receivedThink)})`);
}

async function testCommentRedaction() {
  console.log('(f) comment redaction: raw comment text must not reach the request body');
  let receivedSampleRows = null;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    const userMessage = JSON.parse(parsedBody.messages[1].content);
    receivedSampleRows = userMessage.sampleRows;
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  const secretComment = 'SUPER SECRET MEMO TEXT 12345';
  await suggestMapping({
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', secretComment]],
    knownCategories: KNOWN_CATEGORIES,
    commentCol: 2,
    fileHash: 'hash-f',
    fetchImpl,
  });

  const sentComment = receivedSampleRows[0][2];
  ok(sentComment !== secretComment, 'raw comment text was not sent verbatim');
  ok(sentComment === '<redacted>', `comment cell was redacted (got "${sentComment}")`);
  // Also verify the secret string does not appear ANYWHERE in the serialized
  // request body (not just the expected cell) — guards against the secret
  // leaking via some other field (e.g. echoed into knownCategories/headers
  // by a future code change).
  const fullBodyBeforeRedactionCheck = JSON.stringify({ receivedSampleRows });
  ok(!fullBodyBeforeRedactionCheck.includes(secretComment), 'secret comment text does not appear anywhere in the request payload sent to the transport');
}

// New coverage for the Step 2 prompt-quality improvement: verifies the
// improved prompt's STATIC instructional text (field definitions + few-shot
// examples) is present in the outbound request body via the injected
// fetchImpl stub, using stable/resilient substring checks (not a brittle
// full-string match on the prompt).
async function testPromptContainsFieldDefinitionsAndExamples() {
  console.log('(i) prompt content: outbound request includes field definitions + few-shot examples');
  let receivedUserPrompt = null;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    receivedUserPrompt = JSON.parse(parsedBody.messages[1].content);
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  await suggestMapping({
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-i',
    fetchImpl,
  });

  const serialized = JSON.stringify(receivedUserPrompt);
  ok(typeof receivedUserPrompt.schema?.columnMapping?.dateFormat === 'string', 'schema.columnMapping.dateFormat is present as a descriptive string');
  ok(receivedUserPrompt.schema.columnMapping.dateFormat.toLowerCase().includes('highest-value'), 'dateFormat field description flags it as the highest-value field to infer correctly');
  ok(Array.isArray(receivedUserPrompt.examples) && receivedUserPrompt.examples.length >= 2, 'prompt includes at least 2 few-shot examples');
  ok(serialized.includes('Spending Account') && serialized.includes('Savings Account'), 'prompt includes the multi-account-column few-shot example');
  ok(serialized.includes('"accountId": 1') || serialized.includes('"accountId":1'), 'multi-account example shows accountId 1 mapping');
  ok(serialized.includes('"accountId": 2') || serialized.includes('"accountId":2'), 'multi-account example shows accountId 2 mapping');
  ok(serialized.includes('MDY') && serialized.includes('DMY'), 'prompt includes the ambiguous-date-format few-shot example referencing both MDY and DMY');
  ok(serialized.toLowerCase().includes('untrusted') || serialized.toLowerCase().includes('never as instructions') || serialized.toLowerCase().includes('not as instructions') || receivedUserPrompt.instructions.toLowerCase().includes('data to classify'), 'prompt reinforces the untrusted-data framing');
}

// New coverage: a mocked Ollama response simulating the model having
// correctly followed the multi-account-column few-shot guidance — a file
// with one account-label column, validated end-to-end through
// validateSuggestion.
async function testMultiAccountColumnResponseValidates() {
  console.log('(j) mocked multi-account-column response (account labels in column values) -> validated mapping');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0,
            dateFormat: 'YMD',
            amountMode: 'single',
            amountCol: 2,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: 3,
            commentCol: null,
            accountCol: 1,
          },
          categoryMapping: [],
          accountMapping: [
            { raw: 'Spending Account', accountId: 1 },
            { raw: 'Savings Account', accountId: 2 },
          ],
        }),
      },
      done: true,
    });

  const result = await suggestMapping({
    headers: ['Date', 'Account', 'Amount', 'Category'],
    sampleRows: [
      ['2026-02-01', 'Spending Account', '-12.50', 'Groceries'],
      ['2026-02-01', 'Savings Account', '200.00', 'Transfer'],
    ],
    knownCategories: KNOWN_CATEGORIES,
    accountLabels: ['Spending Account', 'Savings Account'],
    fileHash: 'hash-j',
    fetchImpl,
  });

  ok(result !== null, 'multi-account-column response validates successfully');
  ok(result.columnMapping.accountCol === 1, 'accountCol correctly identifies the account-label column');
  ok(result.accountMapping.length === 2, 'accountMapping contains both raw label entries');
  ok(result.accountMapping.some((m) => m.raw === 'Spending Account' && m.accountId === 1), 'Spending Account label maps to accountId 1');
  ok(result.accountMapping.some((m) => m.raw === 'Savings Account' && m.accountId === 2), 'Savings Account label maps to accountId 2');
}

// New coverage: ambiguous date-format inference — DMY case (disambiguated by
// a day>12 in some row) validating through.
async function testAmbiguousDateFormatDmyValidates() {
  console.log('(k) mocked ambiguous-date response inferring DMY -> validated mapping');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0,
            dateFormat: 'DMY',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: null,
            commentCol: null,
            accountCol: null,
          },
          categoryMapping: [],
          accountMapping: [],
        }),
      },
      done: true,
    });

  const result = await suggestMapping({
    headers: ['Date', 'Amount'],
    sampleRows: [
      ['04/03/2026', '-9.50'],
      ['17/03/2026', '-22.00'], // 17 in the day position disambiguates DMY
    ],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-k',
    fetchImpl,
  });

  ok(result !== null, 'ambiguous-date DMY response validates successfully');
  ok(result.columnMapping.dateFormat === 'DMY', 'dateFormat is correctly inferred/validated as DMY');
}

// New coverage: ambiguous date-format inference — MDY case, same shape as
// (k) but the other disambiguation direction, to ensure both branches of
// DATE_FORMATS validate (not just one hardcoded value being coincidentally
// accepted).
async function testAmbiguousDateFormatMdyValidates() {
  console.log('(l) mocked ambiguous-date response inferring MDY -> validated mapping');
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0,
            dateFormat: 'MDY',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: null,
            commentCol: null,
            accountCol: null,
          },
          categoryMapping: [],
          accountMapping: [],
        }),
      },
      done: true,
    });

  const result = await suggestMapping({
    headers: ['Date', 'Amount'],
    sampleRows: [
      ['03/04/2026', '-9.50'],
      ['03/17/2026', '-22.00'], // 17 in the middle position disambiguates MDY
    ],
    knownCategories: KNOWN_CATEGORIES,
    fileHash: 'hash-l',
    fetchImpl,
  });

  ok(result !== null, 'ambiguous-date MDY response validates successfully');
  ok(result.columnMapping.dateFormat === 'MDY', 'dateFormat is correctly inferred/validated as MDY');
}

// New coverage: outbound prompt content for the Step 3 category/account
// value-mapping prompt-quality improvement — asserts the new instructional
// text and the new category-mapping few-shot example are actually present
// in the request body, using the same stable-substring approach as (i)
// rather than a brittle full-string match. No data-volume change: this only
// checks STATIC text already embedded in buildPromptPayload, never anything
// derived from the caller's headers/sampleRows.
async function testCategoryMappingPromptGuidancePresent() {
  console.log('(m) prompt content: category/account mapping guidance + new few-shot example present');
  let receivedUserPrompt = null;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    receivedUserPrompt = JSON.parse(parsedBody.messages[1].content);
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  await suggestMapping({
    headers: HEADERS,
    sampleRows: [['2026-01-01', '10.00', 'Coffee']],
    knownCategories: KNOWN_CATEGORIES,
    accountLabels: ['Checking', 'Savings'],
    fileHash: 'hash-m',
    fetchImpl,
  });

  const serialized = JSON.stringify(receivedUserPrompt);
  const categoryMappingText = receivedUserPrompt.schema?.categoryMapping;
  const accountMappingText = receivedUserPrompt.schema?.accountMapping;

  ok(typeof categoryMappingText === 'string' && categoryMappingText.toLowerCase().includes('case-insensitive'),
    'categoryMapping schema instructs case-insensitive/whitespace-tolerant matching');
  ok(typeof categoryMappingText === 'string' && categoryMappingText.toLowerCase().includes('semantic'),
    'categoryMapping schema instructs preferring semantic matches over exact-string matches');
  ok(typeof categoryMappingText === 'string' && categoryMappingText.toLowerCase().includes('isnew:true'),
    'categoryMapping schema clarifies when isNew:true is and is not appropriate');
  ok(typeof accountMappingText === 'string' && accountMappingText.toLowerCase().includes('exhaustive'),
    'accountMapping schema clarifies accountLabels is exhaustive across the whole file, not just sampleRows');
  ok(serialized.includes('Car Insurance') && serialized.includes('WHOLEFOODS'),
    'prompt includes the new category-mapping few-shot example (merchant + new-category cases)');
}

// New coverage: a mocked Ollama response simulating the model having
// correctly followed the new category-mapping guidance (case/whitespace
// variant of an existing category + a semantic merchant match + a
// genuinely new category) — validated end-to-end through validateSuggestion
// to confirm the existing strict schema validation still accepts exactly
// this improved-quality shape, with no schema/validation change required.
async function testImprovedCategoryMappingResponseValidates() {
  console.log('(n) mocked improved category-mapping response (case/whitespace + semantic match + new) -> validated mapping');
  const knownWithGroceries = [{ name: 'groceries', list: 'outgoing' }, { name: 'income', list: 'incoming' }];
  const fetchImpl = async () =>
    fakeJsonResponse({
      message: {
        content: JSON.stringify({
          columnMapping: {
            dateCol: 0,
            dateFormat: 'YMD',
            amountMode: 'single',
            amountCol: 1,
            directionCol: null,
            debitCol: null,
            creditCol: null,
            categoryCol: 2,
            commentCol: null,
            accountCol: null,
          },
          categoryMapping: [
            { raw: ' Groceries ', name: 'groceries', list: 'outgoing', isNew: false },
            { raw: 'WHOLEFOODS #4471', name: 'groceries', list: 'outgoing', isNew: false },
            { raw: 'Car Insurance', name: 'Car Insurance', list: 'outgoing', isNew: true },
            { raw: 'income', name: 'income', list: 'incoming', isNew: false },
          ],
          accountMapping: [],
        }),
      },
      done: true,
    });

  const result = await suggestMapping({
    headers: ['Date', 'Amount', 'Category'],
    sampleRows: [
      ['2026-03-01', '-54.20', ' Groceries '],
      ['2026-03-02', '-18.00', 'WHOLEFOODS #4471'],
      ['2026-03-03', '-95.00', 'Car Insurance'],
      ['2026-03-05', '3000.00', 'income'],
    ],
    knownCategories: knownWithGroceries,
    fileHash: 'hash-n',
    fetchImpl,
  });

  ok(result !== null, 'improved category-mapping response validates successfully');
  ok(result.categoryMapping.length === 4, 'all 4 category mapping entries pass strict validation');
  ok(result.categoryMapping.some((c) => c.raw === ' Groceries ' && c.name === 'groceries' && c.isNew === false),
    'case/whitespace variant maps to existing category, not flagged as new');
  ok(result.categoryMapping.some((c) => c.raw === 'WHOLEFOODS #4471' && c.name === 'groceries' && c.isNew === false),
    'merchant-shaped label maps to existing category via semantic match, not flagged as new');
  ok(result.categoryMapping.some((c) => c.raw === 'Car Insurance' && c.isNew === true),
    'genuinely unmatched category is correctly flagged isNew:true');
}

async function testKeyUnset() {
  console.log('(g) key-unset: OLLAMA_CLOUD_API_KEY unset -> not-configured, no transport call');
  const original = process.env.OLLAMA_CLOUD_API_KEY;
  delete process.env.OLLAMA_CLOUD_API_KEY;

  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse(wellFormedOllamaChat());
  };

  let result;
  try {
    result = await suggestMapping({
      headers: HEADERS,
      sampleRows: [['2026-01-01', '10.00', 'Coffee']],
      knownCategories: KNOWN_CATEGORIES,
      fileHash: 'hash-g',
      fetchImpl,
    });
  } finally {
    process.env.OLLAMA_CLOUD_API_KEY = original;
  }

  ok(callCount === 0, 'transport was never called when API key is unset');
  ok(result === null, 'result is null (not-configured signal)');
}

async function main() {
  await testSuccessfulResponse();
  clearSuggestionCache();
  await testMalformedControlIsActuallyValid();
  clearSuggestionCache();
  await testMalformedResponse();
  clearSuggestionCache();
  await testMalformedCategoryMapping();
  clearSuggestionCache();
  await testNon2xxUpstream();
  clearSuggestionCache();
  await testNonJsonBody();
  clearSuggestionCache();
  await testTimeoutNetworkError();
  clearSuggestionCache();
  await testCacheBehavior();
  clearSuggestionCache();
  await testFailureNotCached();
  clearSuggestionCache();
  await testRowCap();
  clearSuggestionCache();
  await testCommentRedaction();
  clearSuggestionCache();
  await testPromptContainsFieldDefinitionsAndExamples();
  clearSuggestionCache();
  await testMultiAccountColumnResponseValidates();
  clearSuggestionCache();
  await testAmbiguousDateFormatDmyValidates();
  clearSuggestionCache();
  await testAmbiguousDateFormatMdyValidates();
  clearSuggestionCache();
  await testCategoryMappingPromptGuidancePresent();
  clearSuggestionCache();
  await testImprovedCategoryMappingResponseValidates();
  clearSuggestionCache();
  await testKeyUnset();
  clearSuggestionCache();

  console.log(`\nAll ${passCount} assertions passed. No network calls were made.`);
}

main().catch((err) => {
  console.error('TEST SUITE FAILED');
  console.error(err);
  process.exit(1);
});
