import XLSX from 'xlsx';
import client from '../db.js';
import { createTransaction, createTransfer } from './transactionService.js';
import { createCategory, getOutgoingNames, getIncomingNames } from './categoryService.js';

// Per-file ValidationError class — matches the codebase pattern of not
// deduping error classes across service files (see transactionService.js,
// categoryService.js).
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

// Ceiling on DATA rows (header excluded) for a single import file. Chosen as
// a generous ceiling for this app's single-user/single-SQLite-file profile —
// see dba's note on the team board for the sizing rationale.
const MAX_IMPORT_ROWS = 20000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Month-name lookup for the text-typed month-abbreviation case below.
// Intentionally short-name keyed (first 3 letters, case-insensitive) since
// that covers both abbreviated ("Jun") and full ("June") month names without
// a long alias table.
const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Matches day-first, month-name-abbreviated date STRINGS such as
// "23-Jun-26", "23-Jun-2026", "23 Jun 2026" — the exact shape Excel produces
// when a date-typed cell uses a custom "dd-mmm-yy"/"dd-mmm-yyyy" display
// format AND SheetJS is asked to format it as text (see
// normalizeDateCellValue below), or when a source file stores the date as
// literal TEXT in that same shape (no underlying numeric serial at all).
// Day-first only: the month NAME makes the day/month order for THIS string
// shape unambiguous by construction (there is no "could be either" case the
// way there is for pure-numeric "23/06/26"), so this is a safe, narrow,
// non-guessing normalization — not a general free-text date parser, and not
// a replacement for the client's DMY/MDY/YMD selector, which still owns
// genuinely ambiguous numeric strings from CSVs.
const TEXT_MONTH_NAME_DATE = /^(\d{1,2})[\s-]([A-Za-z]{3,})[\s,-]+(\d{2,4})$/;

function expandTwoDigitYear(yy) {
  // Mirrors the client's TWO_DIGIT_YEAR_PIVOT convention
  // (importTransforms.js) so a two-digit year normalizes identically
  // regardless of which side of the pipeline expands it.
  return yy <= 68 ? 2000 + yy : 1900 + yy;
}

// Normalizes a single already-extracted cell's date-shaped value to ISO
// 'YYYY-MM-DD', or returns the input unchanged if it isn't a date this
// function recognizes (the client's existing flexible parser / Step 4
// flagging remains the catch-all for everything else, e.g. genuinely
// ambiguous numeric CSV dates like "03/04/2026").
function normalizeTextMonthNameDate(value) {
  const m = TEXT_MONTH_NAME_DATE.exec(value);
  if (!m) return value;
  const day = Number(m[1]);
  const monthAbbrev = m[2].slice(0, 3).toLowerCase();
  const month = MONTH_INDEX[monthAbbrev];
  if (!month) return value; // not a recognized month name — leave untouched
  let year = Number(m[3]);
  if (m[3].length <= 2) year = expandTwoDigitYear(year);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return value; // invalid calendar date (e.g. day 32) — leave for flagging
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Reads one raw SheetJS cell object and returns its FINAL string value for
// the grid, with Excel date cells normalized to ISO regardless of their
// display format.
//
// THE BUG THIS FIXES: when an .xlsx cell holds a true date SERIAL value but
// is custom-formatted as e.g. "dd-mmm-yy", SheetJS's cellDates:true read
// produces a cell with t==='d' and a real JS Date in .v — but sheet_to_json
// with raw:false formats that Date back to text using the CELL'S OWN .z
// format (here "dd-mmm-yy", e.g. "23-Jun-26"), NOT the dateNF option passed
// to sheet_to_json. dateNF only governs SheetJS's own date-shape inference
// (e.g. for CSV text cells with no stored format) — it does NOT override an
// explicit per-cell number format already present on a date-typed xlsx
// cell. Confirmed empirically against a real in-memory .xlsx fixture built
// with XLSX.utils + a cell explicitly set to t:'n', a date serial, and
// z:'dd-mmm-yy' (see server/src/scripts/importDateXlsxTest.js) — the prior
// per-function comment's claim that dateNF "doesn't change true xlsx
// date-serial cell handling" was correct in the narrow sense that dateNF
// itself never touched these cells, but incorrectly implied they'd still
// come out as ISO; they come out as the cell's OWN display format instead.
//
// FIX: read the cell's raw .v directly. If it's a true date cell (t==='d',
// .v instanceof Date — only possible because parseFile reads with
// cellDates:true), format it ourselves from the Date's LOCAL calendar
// fields (immune to any .z display format) instead of trusting
// sheet_to_json's raw:false text cache. LOCAL, not UTC, deliberately:
// SheetJS's CSV date-string inference calls the plain JS `Date` constructor
// on the raw text (e.g. `new Date('2026/03/04')`), and per the JS spec only
// ISO-shaped ("YYYY-MM-DD") strings parse as UTC midnight — any other
// separator (e.g. "2026/03/04") parses as LOCAL midnight instead. Reading
// such a cell's UTC fields can therefore land on the wrong calendar day
// (one day off) depending on the runtime's timezone offset, while its LOCAL
// fields are always correct regardless of which JS Date-parsing branch
// produced the value or which timezone the server runs in — verified
// against both CSV-inferred dates and true xlsx date-serial cells (see
// server/src/scripts/importDateXlsxTest.js). Every other cell type
// (numbers, plain strings) falls through to the existing String(...)
// conversion, EXCEPT a string cell that happens to match the day-mmm-year
// text shape (the genuinely TEXT-typed case — a real serial never reaches
// this branch), which is normalized the same way so both representations
// of "the same Excel date bug" land on identical ISO output.
function normalizeCellValue(cell) {
  if (cell == null) return '';
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const str = cell.v != null ? String(cell.v) : '';
  if (cell.t === 's') {
    return normalizeTextMonthNameDate(str);
  }
  return str;
}

// Parses a CSV or .xlsx file buffer into a generic, rectangular string grid.
// One code path for both formats (SheetJS auto-detects); no extension
// branching. cellDates+dateNF normalize true Excel-date-serial cells, and
// normalizeCellValue (above) re-formats them to ISO from the underlying
// Date object directly — bypassing sheet_to_json's raw:false text cache,
// which uses the cell's OWN display format (e.g. "dd-mmm-yy") rather than
// dateNF. raw:false is still used for non-date cells (numbers/strings still
// get SheetJS's normal formatted-string behavior); the grid is uniformly
// string[][] regardless of source format either way.
export function parseFile(buffer) {
  let workbook;
  try {
    // dateNF must be passed here too, not only to sheet_to_json below: when
    // SheetJS's CSV reader auto-detects a date-shaped text cell (cellDates:
    // true), it caches a formatted string on the cell at READ time using
    // whatever dateNF was in effect then. Passing dateNF only to
    // sheet_to_json (as the original contract specified) is too late — the
    // cache is already populated with SheetJS's own default short-date
    // format (e.g. '6/5/26'), silently mangling the ISO date a CSV exporter
    // actually wrote. Passing the same dateNF at read time makes the cache
    // itself ISO for CSV-inferred dates. For TRUE xlsx date-serial cells
    // that carry their own explicit number format (the dd-mmm-yy bug, see
    // normalizeCellValue above), dateNF has no effect either way — those are
    // now handled by reading cell.v directly instead of relying on this
    // cache at all.
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' });
  } catch (err) {
    throw new ValidationError('Unable to read file: not a valid CSV or Excel file');
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new ValidationError('File has no readable sheet');
  }
  const sheet = workbook.Sheets[firstSheetName];

  // header:1 + raw cell access (not sheet_to_json) so normalizeCellValue can
  // intercept date cells before SheetJS's own raw:false formatting runs.
  // XLSX.utils.sheet_to_json with header:1 ultimately walks the same !ref
  // range and cell map; replicate that walk directly here so every cell —
  // header row included — goes through normalizeCellValue uniformly.
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const grid = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const rowOut = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      rowOut.push(normalizeCellValue(sheet[addr]));
    }
    grid.push(rowOut);
  }

  if (grid.length === 0) {
    throw new ValidationError('File has no columns/rows');
  }

  // Rectangularize the WHOLE grid (header row included) up front, to the
  // MAX width across every row — not just grid[0].length. This matters for
  // the client's data-start-row offset feature: when a legend/title row sits
  // above the real header row, the legend row is often NARROWER than the
  // real header row, so taking width from row 0 would itself truncate the
  // real headers/data once the client re-derives them at a different offset.
  const width = Math.max(...grid.map((row) => row.length));
  const rectGrid = grid.map((row) => {
    const out = new Array(width);
    for (let i = 0; i < width; i += 1) {
      out[i] = row[i] != null ? row[i] : '';
    }
    return out;
  });

  const headers = rectGrid[0].map((h) => String(h));
  if (headers.length === 0) {
    throw new ValidationError('File has no columns');
  }

  const dataRows = rectGrid.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `File has ${dataRows.length} data rows, which exceeds the ${MAX_IMPORT_ROWS}-row import limit`
    );
  }

  // headers/rows keep their current default-offset meaning (header = row 0,
  // data = row 1+) so no existing caller is affected; `grid` is the full
  // rectangularized grid, returned ADDITIONALLY so the client's Step 2
  // "data starts on row __" control can re-derive headers/rows at a
  // different offset without a re-upload or a new endpoint.
  const rows = dataRows;

  return { headers, rows, grid: rectGrid };
}

function assertCategoryDraftShape(draft) {
  const { name, list, account_id } = draft;
  if (!name || !list || account_id == null) {
    throw new ValidationError('categoriesToCreate entries require name, list, and account_id');
  }
  if (!['outgoing', 'incoming'].includes(list)) {
    throw new ValidationError('categoriesToCreate list must be "outgoing" or "incoming"');
  }
}

// Commits a fully-resolved import batch: creates any missing categories
// (skip-if-exists, case-insensitive, scoped per account+list — mirrors
// createCategory's own dup-check scope), then inserts each transaction draft
// via the existing transactionService entry points. Opens ONE interactive
// libsql transaction and threads it (as `exec`) into every
// createCategory/createTransaction/createTransfer call below — a plain
// client.execute runs on a different connection than an already-open
// transaction and would silently lose atomicity across the batch (see team
// board Batch 8 contract). Any ValidationError anywhere in the batch rolls
// back everything that ran before it — nothing is written until the whole
// batch succeeds.
export async function commitImport({ categoriesToCreate = [], transactions = [] } = {}, userId) {
  if (!Array.isArray(categoriesToCreate) || !Array.isArray(transactions)) {
    throw new ValidationError('categoriesToCreate and transactions must be arrays');
  }

  const tx = await client.transaction('write');
  try {
    let created = 0;
    let transfersLinked = 0;
    let categoriesCreated = 0;

    for (const draft of categoriesToCreate) {
      assertCategoryDraftShape(draft);
      const { name, list, account_id } = draft;
      const existingNames = list === 'outgoing'
        ? await getOutgoingNames(account_id, userId, tx)
        : await getIncomingNames(account_id, userId, tx);
      const alreadyExists = existingNames.some(
        (existing) => existing.toLowerCase() === String(name).trim().toLowerCase()
      );
      if (alreadyExists) {
        continue; // benign race: an earlier-in-batch create (or a pre-existing
        // category) already covers this name — skip rather than let
        // createCategory throw and abort the whole commit.
      }
      await createCategory({ name, list, account_id }, userId, tx);
      categoriesCreated += 1;
    }

    for (const draft of transactions) {
      if (!draft || typeof draft !== 'object') {
        throw new ValidationError('each transaction draft must be an object');
      }
      if (draft.type === 'normal') {
        await createTransaction({
          date: draft.date,
          account_id: draft.account_id,
          direction: draft.direction,
          category: draft.category,
          amount: draft.amount,
          comment: draft.comment,
        }, userId, tx);
        created += 1;
      } else if (draft.type === 'transfer') {
        await createTransfer({
          date: draft.date,
          from_account_id: draft.from_account_id,
          to_account_id: draft.to_account_id,
          amount: draft.amount,
          comment: draft.comment,
        }, userId, tx);
        transfersLinked += 1;
      } else {
        throw new ValidationError(`unknown transaction draft type "${draft && draft.type}"`);
      }
    }

    await tx.commit();
    return { created, transfersLinked, categoriesCreated };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export { ValidationError, MAX_IMPORT_ROWS };
