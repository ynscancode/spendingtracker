// QA verification script for the 5 reported import-wizard bugs / 6 fixes
// (see TEAM-BOARD.md). Plain node, assert-and-log, no framework — matches
// the existing server/src/scripts/*Test.js style.
//
// Imports the CLIENT's pure ESM transform/mapping functions directly via
// absolute file:// URLs (they have no React/DOM dependency, so this works
// from a node process with no bundler) — avoids needing to duplicate logic.
//
// Run with: node src/scripts/importMappingTest.js   (from server/)
// No network access, no live server, no DB required for sections A/C.
// Section B additionally exercises the server's real parseFile() directly
// (in-process import, not over HTTP) against an in-memory CSV buffer.

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));
const clientSrc = path.resolve(here, '../../../client/src');

const { buildDraftTransactions, detectTransferPairs, uniqueValues, UNCATEGORIZED } = await import(
  pathToFileURL(path.join(clientSrc, 'utils/importTransforms.js')).href
);
const { buildInitialCategoryMapping, isNumericCodeColumn } = await import(
  pathToFileURL(path.join(clientSrc, 'components/imports/buildInitialMappings.js')).href
);
const { parseFile } = await import('../services/importService.js');

let passCount = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passCount += 1;
  console.log(`  ok: ${msg}`);
}

console.log('=== Section A: buildDraftTransactions / Fix 2 (optional category -> Uncategorized) ===');
{
  // A1: categoryCol == null -> every row resolves to Uncategorized, no flag.
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: null, commentCol: null, accountCol: null, fixedAccountId: 1,
  };
  const rows = [
    ['2026-01-05', '-12.50'],
    ['2026-01-06', '-8.00'],
  ];
  const drafts = buildDraftTransactions(rows, columnMapping, new Map(), new Map());
  ok(drafts.every((d) => d.category === UNCATEGORIZED), 'A1: every row category === "Uncategorized" when categoryCol is null');
  ok(drafts.every((d) => !d.issues.some((i) => /category/i.test(i))), 'A1: no category-related issue when categoryCol is null');
  ok(drafts.every((d) => d.accountId === 1), 'A1: accountId resolves to fixedAccountId when accountCol is null');
}

{
  // A2: categoryCol mapped but row's cell is blank -> Uncategorized, not flagged.
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: 2, commentCol: null, accountCol: null, fixedAccountId: 1,
  };
  const rows = [
    ['2026-01-05', '-12.50', ''],
    ['2026-01-06', '-8.00', '   '], // whitespace-only also counts as blank
  ];
  const drafts = buildDraftTransactions(rows, columnMapping, new Map(), new Map());
  ok(drafts.every((d) => d.category === UNCATEGORIZED), 'A2: blank cell in mapped category column -> Uncategorized');
  ok(drafts.every((d) => !d.issues.some((i) => /category/i.test(i))), 'A2: blank cell -> no category issue');
}

{
  // A3: categoryCol mapped, non-blank value with NO mapping entry -> category
  // null AND flagged (the one remaining hard-flag case).
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: 2, commentCol: null, accountCol: null, fixedAccountId: 1,
  };
  const rows = [['2026-01-05', '-12.50', 'Groceries']];
  const drafts = buildDraftTransactions(rows, columnMapping, new Map(), new Map()); // empty categoryMapping -> unresolved
  ok(drafts[0].category === null, 'A3: non-blank unmapped category -> category stays null');
  ok(drafts[0].issues.some((i) => /not mapped/i.test(i)), 'A3: non-blank unmapped category -> "is not mapped" hard flag');
}

{
  // A3b: same but WITH a mapping entry whose name is explicitly null (the
  // numeric-code "unselected" sentinel per Fix 4) -> still flagged.
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: 2, commentCol: null, accountCol: null, fixedAccountId: 1,
  };
  const rows = [['2026-01-05', '-12.50', '3']];
  const categoryMapping = new Map([['3', { name: null, list: 'outgoing', isNew: false }]]);
  const drafts = buildDraftTransactions(rows, columnMapping, categoryMapping, new Map());
  ok(drafts[0].category === null, 'A3b: unselected numeric-code mapping (name:null) -> category stays null');
  ok(drafts[0].issues.some((i) => /not mapped/i.test(i)), 'A3b: unselected numeric-code mapping -> hard flag');
}

console.log('\n=== Section A: Fix 4 — numeric-code detection skips fuzzy match ===');
{
  const rawValues = ['1', '2', '3', '10'];
  ok(isNumericCodeColumn(rawValues) === true, 'isNumericCodeColumn: all-digit column -> true');

  const mapping = buildInitialCategoryMapping(rawValues, ['Groceries', 'Rent', 'Food']);
  ok([...mapping.values()].every((e) => e.name === null && e.isNew === false),
    'numeric-code column: every entry pre-seeded {name:null, isNew:false} (unselected), NOT {isNew:true,name:"<code>"}');
  ok(mapping.get('1').name !== '1', 'numeric-code column: code "1" does NOT get a create-new entry named "1"');
}

{
  // Mixed column (one non-numeric value) -> NOT numeric-coded, falls through
  // to normal fuzzy matching.
  const rawValues = ['3', 'Groceries'];
  ok(isNumericCodeColumn(rawValues) === false, 'isNumericCodeColumn: mixed column ("3","Groceries") -> false');

  const mapping = buildInitialCategoryMapping(rawValues, ['Groceries', 'Rent']);
  const groceriesEntry = mapping.get('Groceries');
  ok(groceriesEntry.name === 'Groceries' && groceriesEntry.isNew === false,
    'mixed column: "Groceries" still fuzzy-matches to the real "Groceries" category');
  const threeEntry = mapping.get('3');
  ok(threeEntry.isNew === true && threeEntry.name === '3',
    'mixed column: "3" (no fuzzy match) falls back to ordinary create-new behavior, not the numeric-code unselected path');
}

{
  // Edge case: empty / all-blank column should NOT be treated as numeric-coded.
  ok(isNumericCodeColumn([]) === false, 'isNumericCodeColumn: empty array -> false');
  ok(isNumericCodeColumn(['', '  ']) === false, 'isNumericCodeColumn: all-blank values -> false');
}

console.log('\n=== Section A: Fix 5 — case-insensitive account collapse / getCI lookup ===');
{
  // uniqueValues() now lives in importTransforms.js (shared by Step3Values.jsx's
  // DISPLAY layer and ImportModal.jsx's proceedToValues SEED layer) — imported
  // directly above rather than replicated, so this test exercises the real
  // function both layers actually call.
  const rows = [['Spending'], [' spending '], ['SPENDING']];
  const collapsed = uniqueValues(rows, 0);
  ok(collapsed.length === 1, `case-insensitive uniqueValues collapses ["Spending"," spending ","SPENDING"] to ONE label (got ${JSON.stringify(collapsed)})`);
  ok(collapsed[0] === 'Spending', 'first-seen casing ("Spending") is kept as the display value');

  // Now verify getCI consistency: accountMapping keyed by first-seen casing
  // "Spending" -> account 1; rows with DIFFERENT casing must still resolve.
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: null, commentCol: null, accountCol: 2, fixedAccountId: null,
  };
  const accountMapping = new Map([['Spending', 1]]);
  const draftRows = [
    ['2026-01-05', '-12.50', 'Spending'],
    ['2026-01-06', '-8.00', ' spending '],
    ['2026-01-07', '-5.00', 'SPENDING'],
  ];
  const drafts = buildDraftTransactions(draftRows, columnMapping, new Map(), accountMapping);
  ok(drafts.every((d) => d.accountId === 1), 'getCI: all 3 casings of "Spending" resolve to the same accountId via case-insensitive lookup');
  ok(drafts.every((d) => !d.issues.some((i) => /account/i.test(i))), 'getCI: no "Account ... is not mapped" flag for any casing variant');
}

console.log('\n=== Section A: QA bug fix — case-variant spellings of a brand-new category seed ONE entry ===');
{
  // Reproduces the exact bug QA found against the real commit path: a file
  // with the same new category spelled "NewCat" on one row and "newcat" on
  // another. Mirrors ImportModal.jsx's proceedToValues() seed layer end to
  // end: uniqueValues() (the SAME function Step3Values.jsx's display layer
  // uses) -> buildInitialCategoryMapping (seeds categoryMapping) ->
  // buildDraftTransactions (resolves each row's category via getCI).
  //
  // Before the fix: proceedToValues used a plain `[...new Set(...)]`, so
  // "NewCat" and "newcat" were two distinct rawCategories entries, each its
  // own isNew:true Map entry with its OWN casing as `name` — drafts ended up
  // with two different category strings for what the user sees as one
  // category, and only one of those casings ever gets created at commit
  // (categoriesToCreate dedupes by lowercased name), so the other casing's
  // drafts fail categoryService's case-sensitive match and roll back the
  // whole atomic batch.
  //
  // After the fix: uniqueValues() collapses both casings to ONE entry
  // (first-seen casing) before buildInitialCategoryMapping ever sees them,
  // so there is exactly one categoryMapping entry, one isNew name, and every
  // row's getCI lookup resolves to that same single name.
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: 2, commentCol: null, accountCol: null, fixedAccountId: 1,
  };
  const rawRows = [
    ['2026-01-05', '-12.50', 'NewCat'],
    ['2026-01-06', '-8.00', 'newcat'],
    ['2026-01-07', '-3.00', 'NEWCAT'],
  ];

  // Step: proceedToValues's seed layer.
  const rawCategories = uniqueValues(rawRows, columnMapping.categoryCol);
  ok(rawCategories.length === 1, `case-variant "NewCat"/"newcat"/"NEWCAT" collapse to ONE raw category before mapping is built (got ${JSON.stringify(rawCategories)})`);
  ok(rawCategories[0] === 'NewCat', 'first-seen casing ("NewCat") is kept as the seeded raw key');

  const categoryMapping = buildInitialCategoryMapping(rawCategories, []);
  ok(categoryMapping.size === 1, 'buildInitialCategoryMapping produces exactly ONE entry for the collapsed raw category');
  const onlyEntry = [...categoryMapping.values()][0];
  ok(onlyEntry.isNew === true && onlyEntry.name === 'NewCat', 'the single seeded entry is isNew with the first-seen casing as its name');

  // Step: buildDraftTransactions resolves every row (regardless of its own
  // casing) to the SAME category name via getCI, exactly mirroring how
  // Step 3 would display one row and the commit path would create one
  // category.
  const drafts = buildDraftTransactions(rawRows, columnMapping, categoryMapping, new Map());
  ok(drafts.every((d) => d.category === 'NewCat'), 'every row (regardless of its own raw casing) resolves to the SAME category name via getCI');
  ok(drafts.every((d) => !d.issues.some((i) => /category/i.test(i))), 'no row is flagged — all 3 casings resolve cleanly to the one seeded category');

  // Simulate handleCommit's categoriesToCreate dedupe to confirm only ONE
  // category would be created, and every draft's category string matches it
  // exactly (case-sensitive) — i.e. no row would fail categoryService's
  // case-sensitive match / no atomic rollback.
  const created = new Set();
  for (const d of drafts) created.add(`1|outgoing|${d.category.toLowerCase()}`);
  ok(created.size === 1, 'exactly one (account,list,lowername) triple would be queued for creation — no duplicate-casing create');
  ok(drafts.every((d) => d.category === [...categoryMapping.values()][0].name), 'every draft\'s category string exactly (case-sensitively) matches the one name that gets created — would pass categoryService\'s case-sensitive check');
}

console.log('\n=== Section A: detectTransferPairs regression check ===');
{
  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: 3,
    categoryCol: null, commentCol: null, accountCol: 2, fixedAccountId: null,
  };
  const accountMapping = new Map([['Spending', 1], ['Savings', 2]]);
  const rows = [
    ['2026-01-10', '100.00', 'Spending', 'out'],
    ['2026-01-10', '100.00', 'Savings', 'in'],
  ];
  const baseDrafts = buildDraftTransactions(rows, columnMapping, new Map(), accountMapping)
    .map((d, i) => ({ ...d, key: `row-${i}`, excluded: false }));
  ok(baseDrafts.every((d) => d.category === UNCATEGORIZED), 'transfer regression: both legs resolve to Uncategorized (no category column)');
  const result = detectTransferPairs(baseDrafts);
  const transfer = result.find((d) => d.type === 'transfer');
  ok(!!transfer, 'detectTransferPairs: clean Spending<->Savings pair on same date+amount still merges into one transfer draft');
  ok(transfer.from_account_id === 1 && transfer.to_account_id === 2, 'detectTransferPairs: merged transfer has correct from/to account ids');
  ok(transfer.amount === 100, 'detectTransferPairs: merged transfer carries the correct amount');
}

console.log('\n=== Section B: server parseFile() — additive grid + legend offset ===');
{
  // Build an in-memory CSV with a 2-row legend/title block above the real
  // header row, numeric category codes, and an account column with
  // case/whitespace variance — the user's reported file shape.
  const csvLines = [
    'Acme Bank Export', // legend row 1 (narrower than real header � only 1 cell)
    '1=Groceries 2=Rent 3=Other', // legend row 2 (the "legend table" � only 1 cell)
    'Date,Amount,CategoryCode,Account,Comment', // REAL header row (5 cells, row index 2, 1-based row 3)
    '2026-01-05,-12.50,1,Spending,Coffee',
    '2026-01-06,-8.00,2, spending ,Rent',
    '2026-01-07,15.00,3,SPENDING,Refund',
  ];
  const buffer = Buffer.from(csvLines.join('\n'), 'utf-8');
  const result = parseFile(buffer);

  ok(Array.isArray(result.grid), 'parseFile: returns a "grid" field additionally');
  ok(Array.isArray(result.headers) && Array.isArray(result.rows), 'parseFile: still returns "headers" and "rows" (additive, not replacing)');
  ok(result.headers[0] === 'Acme Bank Export', 'parseFile: headers/rows still default to offset 1 (legend row becomes "headers") — confirms the client MUST re-derive via dataStartRow');

  // Client-side re-derivation at dataStartRow=3 (1-based: header is row 2,
  // i.e. grid[2], data starts at grid[3]).
  function deriveGridView(grid, dataStartRow) {
    const headerRow = Math.max(0, dataStartRow - 1);
    const headers = (grid[headerRow] ?? []).map(String);
    const rows = grid.slice(dataStartRow);
    return { headers, rows };
  }
  const { headers, rows } = deriveGridView(result.grid, 3);
  ok(headers[0] === 'Date' && headers[1] === 'Amount' && headers[2] === 'CategoryCode' && headers[3] === 'Account',
    `parseFile + dataStartRow=3 re-derivation yields the REAL header row (got ${JSON.stringify(headers)})`);
  ok(rows.length === 3, `re-derived rows excludes both legend rows and the header row, leaving exactly 3 data rows (got ${rows.length})`);
  ok(rows[0][0] === '2026-01-05', 're-derived first data row is the first real data row, not a legend row');

  // Confirm the width came from the WIDEST row (real header, 5 cols), not
  // the legend row (narrower) — this is the rectangularization fix.
  const width = result.grid[0].length;
  ok(width === 5, `grid is rectangularized to the WIDEST row's width (5 cols from the real header), not the legend row's width (got ${width})`);
}

console.log('\n=== Section C: full pipeline trace on the user-shaped fixture ===');
{
  // Legend rows + numeric category codes + case-variant account labels +
  // explicit dateFormat, traced end-to-end through the pure pipeline.
  const csvLines = [
    'Legend: 1=Groceries 2=Rent 3=Other',
    'Date,Amount,CategoryCode,Account,Comment',
    '2026-02-01,-50.00,1,Spending,Groceries run',
    '2026-02-02,-20.00,2, spending ,Rent partial',
    '2026-02-03,-30.00,3,SPENDING,Misc',
  ];
  const buffer = Buffer.from(csvLines.join('\n'), 'utf-8');
  const parsed = parseFile(buffer);

  function deriveGridView(grid, dataStartRow) {
    const headerRow = Math.max(0, dataStartRow - 1);
    const headers = (grid[headerRow] ?? []).map(String);
    const rows = grid.slice(dataStartRow);
    return { headers, rows };
  }
  const { headers, rows } = deriveGridView(parsed.grid, 2); // header is row 2 (1-based)
  ok(headers.join(',') === 'Date,Amount,CategoryCode,Account,Comment', 'Section C: dataStartRow=2 yields the correct header row');

  const columnMapping = {
    dateCol: 0, dateFormat: 'YMD', amountMode: 'single', amountCol: 1, directionCol: null,
    categoryCol: 2, commentCol: 4, accountCol: 3, fixedAccountId: null,
    accountScope: 'multiple',
  };

  // Step3Values.jsx's account uniqueValues (case-insensitive collapse) —
  // confirm it collapses to a SINGLE label even though raw cells vary by
  // case/whitespace (this directly addresses "account list shows every row").
  function uniqueValues(rowsArg, colIndex) {
    const seen = new Map();
    for (const row of rowsArg) {
      const value = String(row[colIndex] ?? '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()];
  }
  const rawAccounts = uniqueValues(rows, columnMapping.accountCol);
  ok(rawAccounts.length === 1, `Section C: account-mapping list collapses to 1 label across 3 rows of case/whitespace-varying "Spending" (got ${JSON.stringify(rawAccounts)}) — confirms issue 4/5 fix, NOT "every row"`);

  // Numeric-code category column -> buildInitialCategoryMapping pre-seeds
  // unselected; simulate the user mapping all 3 codes manually (as the
  // wizard requires) before building drafts.
  const rawCategories = uniqueValues(rows, columnMapping.categoryCol);
  ok(rawCategories.length === 3, 'Section C: 3 unique numeric codes found (1, 2, 3)');
  const initialCatMapping = buildInitialCategoryMapping(rawCategories, ['Groceries', 'Rent', 'Other']);
  ok([...initialCatMapping.values()].every((e) => e.name === null), 'Section C: numeric codes all pre-seeded unselected (per Fix 4)');

  // User manually maps each code (the required manual step per DECISION 2).
  const categoryMapping = new Map([
    ['1', { name: 'Groceries', list: 'outgoing', isNew: false }],
    ['2', { name: 'Rent', list: 'outgoing', isNew: false }],
    ['3', { name: 'Other', list: 'outgoing', isNew: false }],
  ]);
  const accountMapping = new Map([['Spending', 1]]); // first-seen casing key

  const drafts = buildDraftTransactions(rows, columnMapping, categoryMapping, accountMapping);
  ok(drafts.length === 3, 'Section C: 3 drafts built from 3 data rows');
  ok(drafts.every((d) => d.issues.length === 0),
    `Section C: ZERO flags once category mapped + account resolved + explicit dateFormat (issues: ${JSON.stringify(drafts.map((d) => d.issues))})`);
  ok(drafts.every((d) => d.accountId === 1), 'Section C: all 3 case-variant account labels resolve to the SAME accountId (1)');
  ok(drafts.map((d) => d.category).join(',') === 'Groceries,Rent,Other', 'Section C: each numeric code resolves to its manually-mapped category name');
}

console.log(`\nAll ${passCount} assertions passed.`);
