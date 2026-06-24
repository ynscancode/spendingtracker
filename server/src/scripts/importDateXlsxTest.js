// REAL (non-mocked) verification of the .xlsx month-abbreviation date fix
// in parseFile() (server/src/services/importService.js). Builds a real
// .xlsx file in-memory via XLSX.utils + XLSX.write (no fixture binary is
// committed) and runs it through the ACTUAL parseFile(), asserting on the
// resulting string[][] grid. Also exercises the equivalent CSV path so the
// pre-existing ISO-passthrough fix described in parseFile's own comments
// doesn't regress.
//
// THE BUG THIS GUARDS AGAINST: a user's real .xlsx has a date column that is
// intended as dd/mm/yy but Excel DISPLAYS it with a short month name (e.g.
// "23-Jun-26") — the classic signature of a date-serial cell with a custom
// "dd-mmm-yy" number format. Before the fix, parseFile() returned that
// display string verbatim ("23-Jun-26"), which the client's
// parseDateFlexible() can never parse (it requires three purely-numeric
// parts) — every row in the file got flagged "Date ... could not be
// parsed" in Step 4, even though the underlying data was perfectly valid.
//
// Run with: node src/scripts/importDateXlsxTest.js (from server/)
// No network access, no live server required.

import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseFile } from '../services/importService.js';

let passCount = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passCount += 1;
  console.log(`  ok: ${msg}`);
}

// Derives the correct Excel date serial for a calendar date by round-
// tripping through SheetJS's own writer/reader, rather than hand-rolling
// the 1900-leap-bug epoch arithmetic (avoids introducing a second,
// independently-buggy serial calculation in test code).
function serialFor(y, m, d) {
  const tmpWb = XLSX.utils.book_new();
  const tmpWs = { '!ref': 'A1:A1', A1: { t: 'd', v: new Date(Date.UTC(y, m - 1, d)) } };
  XLSX.utils.book_append_sheet(tmpWb, tmpWs, 'tmp');
  const buf = XLSX.write(tmpWb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  return wb.Sheets.tmp.A1.v;
}

function buildXlsxBuffer(cells, ref) {
  const wb = XLSX.utils.book_new();
  const ws = { ...cells, '!ref': ref };
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Case (a): a TRUE date-serial cell (t:'n', numeric serial), custom-
// formatted as dd-mmm-yy — the real-world scenario reported by the user.
// ---------------------------------------------------------------------------
function testSerialDateWithMonthAbbrevFormat() {
  console.log('(a) true date-serial cell, dd-mmm-yy custom format');
  const serial = serialFor(2026, 6, 23);
  const buffer = buildXlsxBuffer(
    {
      A1: { t: 's', v: 'Date' },
      B1: { t: 's', v: 'Amount' },
      A2: { t: 'n', v: serial, z: 'dd-mmm-yy' },
      B2: { t: 'n', v: -12.5 },
    },
    'A1:B2'
  );
  const { headers, rows } = parseFile(buffer);
  ok(headers[0] === 'Date' && headers[1] === 'Amount', 'headers parsed correctly');
  ok(rows[0][0] === '2026-06-23', `serial+dd-mmm-yy cell normalizes to ISO (got "${rows[0][0]}")`);
  ok(rows[0][1] === '-12.5', 'amount cell unaffected by date normalization');
}

// ---------------------------------------------------------------------------
// Case (b): a TEXT-typed cell (t:'s') holding the literal display string
// "23-Jun-26" — the other real-world shape Excel can produce (no underlying
// numeric serial at all, e.g. if the column was pasted/exported as text).
// ---------------------------------------------------------------------------
function testTextTypedMonthAbbrevDate() {
  console.log('(b) text-typed "23-Jun-26" cell (no numeric serial)');
  const buffer = buildXlsxBuffer(
    {
      A1: { t: 's', v: 'Date' },
      B1: { t: 's', v: 'Amount' },
      A2: { t: 's', v: '23-Jun-26' },
      B2: { t: 's', v: '-40.00' },
    },
    'A1:B2'
  );
  const { rows } = parseFile(buffer);
  ok(rows[0][0] === '2026-06-23', `text-typed month-abbrev cell normalizes to ISO (got "${rows[0][0]}")`);
}

// ---------------------------------------------------------------------------
// Case (c): a full multi-row realistic fixture (3 rows, mixed in/out
// amounts) — confirms every row in a real-shaped file clears date parsing,
// i.e. the Step 4 mass-flag bug is actually fixed, not just a single cell.
// ---------------------------------------------------------------------------
function testFullFixtureNoRowsFlagged() {
  console.log('(c) full multi-row fixture — no row should fail ISO date parsing');
  const cells = {
    A1: { t: 's', v: 'Date' },
    B1: { t: 's', v: 'Amount' },
    C1: { t: 's', v: 'Category' },
    D1: { t: 's', v: 'Comment' },
  };
  const data = [
    [23, 6, 2026, -12.5, 'food', 'Lunch'],
    [20, 6, 2026, -40, 'shopping', 'Store'],
    [18, 6, 2026, 500, 'income', 'Paycheck'],
  ];
  let r = 2;
  for (const [d, m, y, amt, cat, comment] of data) {
    cells[`A${r}`] = { t: 'n', v: serialFor(y, m, d), z: 'dd-mmm-yy' };
    cells[`B${r}`] = { t: 'n', v: amt };
    cells[`C${r}`] = { t: 's', v: cat };
    cells[`D${r}`] = { t: 's', v: comment };
    r += 1;
  }
  const buffer = buildXlsxBuffer(cells, `A1:D${r - 1}`);
  const { rows } = parseFile(buffer);
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const allIso = rows.every((row) => isoRe.test(row[0]));
  ok(allIso, `all ${rows.length} rows produce ISO dates (zero would-be-flagged rows)`);
  ok(rows[0][0] === '2026-06-23' && rows[1][0] === '2026-06-20' && rows[2][0] === '2026-06-18',
    'each row maps to its correct distinct calendar date (no off-by-one)');
}

// ---------------------------------------------------------------------------
// Case (d): CSV regression guard — true ISO dates in a CSV must still pass
// through unchanged (the pre-existing dateNF-at-read-time fix this change
// must not regress).
// ---------------------------------------------------------------------------
function testCsvIsoPassthroughNotRegressed() {
  console.log('(d) CSV ISO date passthrough (regression guard)');
  const csv = 'Date,Amount\n2026-06-05,-12.50\n2026-06-06,-40.00\n';
  const { rows } = parseFile(Buffer.from(csv));
  ok(rows[0][0] === '2026-06-05', `CSV ISO date "2026-06-05" passes through unchanged (got "${rows[0][0]}")`);
  ok(rows[1][0] === '2026-06-06', `CSV ISO date "2026-06-06" passes through unchanged (got "${rows[1][0]}")`);
}

// ---------------------------------------------------------------------------
// Case (e): CSV text-typed month-abbreviation date — confirms the same
// normalization also covers a CSV file with a "23-Jun-26"-shaped column
// (CSV cells are always text-typed, so this exercises the same code path as
// case (b) through a different file format).
// ---------------------------------------------------------------------------
function testCsvMonthAbbrevDate() {
  console.log('(e) CSV with a "23-Jun-26"-shaped date column');
  const csv = 'Date,Amount\n23-Jun-26,-12.50\n';
  const { rows } = parseFile(Buffer.from(csv));
  ok(rows[0][0] === '2026-06-23', `CSV month-abbrev date normalizes to ISO (got "${rows[0][0]}")`);
}

// ---------------------------------------------------------------------------
// Case (f): genuinely ambiguous DAY-FIRST numeric date (no month name, no
// 4-digit leading year) must NOT be touched by this fix — it's still the
// client's DMY/MDY selector's job, not something the server should guess.
// ---------------------------------------------------------------------------
function testAmbiguousNumericDateUntouched() {
  console.log('(f) ambiguous day-first numeric date is left untouched (not the server\'s job)');
  const csv = 'Date,Amount\n23/06/26,-12.50\n';
  const { rows } = parseFile(Buffer.from(csv));
  ok(rows[0][0] === '23/06/26', `ambiguous numeric date is NOT normalized server-side (got "${rows[0][0]}")`);
}

// ---------------------------------------------------------------------------
// Case (g): an unrecognized "month name" (typo / garbage) must fall through
// unchanged rather than crash or silently coerce to a wrong date.
// ---------------------------------------------------------------------------
function testUnrecognizedMonthNameUntouched() {
  console.log('(g) unrecognized month-name-shaped text falls through unchanged');
  const csv = 'Date,Amount\n23-Xyz-26,-12.50\n';
  const { rows } = parseFile(Buffer.from(csv));
  ok(rows[0][0] === '23-Xyz-26', `unrecognized month abbreviation left untouched (got "${rows[0][0]}")`);
}

// ---------------------------------------------------------------------------
// Case (h): a non-date free-text comment that happens to contain dashes
// must NOT be misinterpreted as a date by the month-abbrev normalizer (it
// shouldn't match the narrow regex at all).
// ---------------------------------------------------------------------------
function testNonDateTextUntouched() {
  console.log('(h) non-date free text with dashes is left untouched');
  const csv = 'Date,Comment\n2026-06-23,Some-Random-Text\n';
  const { rows } = parseFile(Buffer.from(csv));
  ok(rows[0][1] === 'Some-Random-Text', `unrelated dashed text is not mangled (got "${rows[0][1]}")`);
}

function main() {
  testSerialDateWithMonthAbbrevFormat();
  testTextTypedMonthAbbrevDate();
  testFullFixtureNoRowsFlagged();
  testCsvIsoPassthroughNotRegressed();
  testCsvMonthAbbrevDate();
  testAmbiguousNumericDateUntouched();
  testUnrecognizedMonthNameUntouched();
  testNonDateTextUntouched();

  console.log(`\nAll ${passCount} assertions passed. No network calls were made (this script never imports/uses fetch).`);
}

main();
