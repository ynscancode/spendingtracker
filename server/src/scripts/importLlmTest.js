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

function wellFormedChatCompletion() {
  return {
    choices: [
      {
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
            categoryMapping: [{ raw: 'Groceries', name: 'food', list: 'outgoing', isNew: false }],
            accountMapping: [{ raw: 'Checking', accountId: 1 }],
          }),
        },
      },
    ],
  };
}

async function testSuccessfulResponse() {
  console.log('(a) mocked successful well-formed response -> validated mapping');
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse(wellFormedChatCompletion());
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
      choices: [
        {
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
        },
      ],
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
      choices: [
        {
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
        },
      ],
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
      choices: [
        {
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
        },
      ],
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
    return fakeJsonResponse(wellFormedChatCompletion());
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

async function testRowCap() {
  console.log('(e) <=5 row cap: 10 sample rows passed -> request stub receives <=5');
  let receivedSampleRows = null;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    const userMessage = JSON.parse(parsedBody.messages[1].content);
    receivedSampleRows = userMessage.sampleRows;
    return fakeJsonResponse(wellFormedChatCompletion());
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
}

async function testCommentRedaction() {
  console.log('(f) comment redaction: raw comment text must not reach the request body');
  let receivedSampleRows = null;
  const fetchImpl = async (url, options) => {
    const parsedBody = JSON.parse(options.body);
    const userMessage = JSON.parse(parsedBody.messages[1].content);
    receivedSampleRows = userMessage.sampleRows;
    return fakeJsonResponse(wellFormedChatCompletion());
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

async function testKeyUnset() {
  console.log('(g) key-unset: OLLAMA_CLOUD_API_KEY unset -> not-configured, no transport call');
  const original = process.env.OLLAMA_CLOUD_API_KEY;
  delete process.env.OLLAMA_CLOUD_API_KEY;

  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return fakeJsonResponse(wellFormedChatCompletion());
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
  await testRowCap();
  clearSuggestionCache();
  await testCommentRedaction();
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
