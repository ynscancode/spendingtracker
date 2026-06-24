// Pure functions powering the import wizard's column-mapping -> draft ->
// transfer-detection pipeline. No React, no API calls — everything here
// operates on plain data so it's easy to unit-reason-about and test.

// Sentinel category name used whenever a row has no resolved category — no
// category column mapped at all, or a mapped column whose cell is blank
// (product-owner DECISION 1). Exactly "Uncategorized" (<=30 chars, not in
// RESERVED_NAMES) so categoryService.createCategory accepts it as an
// ordinary, account+list-scoped, non-system category like any other.
export const UNCATEGORIZED = 'Uncategorized';

// Case-insensitive collapse of a column's raw cell values down to one entry
// per distinct value, first-seen casing kept as the representative string.
// Shared by Step3Values.jsx (the DISPLAY layer — one row per unique value)
// and ImportModal.jsx's proceedToValues (the SEED layer — the array handed
// to buildInitialCategoryMapping/buildInitialAccountMapping to build the
// initial Maps). Both layers MUST use this exact same function rather than
// independently-written equivalents: if the seed layer collapsed casing
// differently (or not at all), a brand-new "+ Create new" category spelled
// with inconsistent casing across rows (e.g. "NewCat" / "newcat") would seed
// TWO separate categoryMapping entries with two different isNew names —
// commitImport's categoriesToCreate dedupes by lowercased name and creates
// only ONE row, but the transaction drafts still carry the other casing
// verbatim, which categoryService's case-SENSITIVE match then rejects,
// rolling back the whole atomic commit batch. Collapsing once, here, with
// one casing surviving into the Map key categoryMapping/accountMapping are
// built from, is what keeps the seed/display/lookup layers consistent:
// getCI() below resolves any row's casing back to this same single key.
export function uniqueValues(rows, colIndex) {
  if (colIndex == null) return [];
  const seen = new Map(); // lowerKey -> firstSeenOriginal
  for (const row of rows) {
    const value = String(row[colIndex] ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

// Case-insensitive Map lookup: tries an exact key match first (the common,
// fast case), then falls back to a case-insensitive scan. Used for both
// account and category raw-value resolution so collapsing uniqueValues()
// case-insensitively (Fix 5) stays consistent with how buildDraftTransactions
// resolves each row — a row whose casing differs from the first-seen casing
// Step 3 displayed would otherwise miss the Map and get wrongly flagged.
function getCI(map, raw) {
  if (map.has(raw)) return map.get(raw);
  const lower = String(raw).toLowerCase();
  for (const [k, v] of map) {
    if (String(k).toLowerCase() === lower) return v;
  }
  return undefined;
}

// ---------- Date parsing ----------

// Two-digit-year pivot: 00-68 -> 2000-2068, 69-99 -> 1969-1999 (matches the
// common Excel/POSIX strtotime convention). Documented here since it's the
// one truly arbitrary judgment call in date parsing.
const TWO_DIGIT_YEAR_PIVOT = 68;

function expandTwoDigitYear(yy) {
  return yy <= TWO_DIGIT_YEAR_PIVOT ? 2000 + yy : 1900 + yy;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  // Reject overflowed dates like 2026-02-30 (Date would roll it to March).
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Parses `raw` according to `format` ('YMD' | 'MDY' | 'DMY'). Returns a
// normalized 'YYYY-MM-DD' string, or null if the value can't be parsed as a
// valid date in that format. Never throws — invalid input is the caller's
// signal to flag the row, not a crash.
//
// Already-ISO values (e.g. dates the server's SheetJS read auto-detected and
// normalized) pass through regardless of `format`, since 'YYYY-MM-DD' is
// unambiguous on its own.
export function parseDateFlexible(raw, format) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidYmd(year, month, day) ? `${isoMatch[1]}-${pad2(month)}-${pad2(day)}` : null;
  }

  // Generic separator-delimited numeric date: splits on '/', '-', or '.'.
  const parts = trimmed.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;

  let [p1, p2, p3] = parts.map(Number);
  let year;
  let month;
  let day;

  if (format === 'YMD') {
    year = p1; month = p2; day = p3;
  } else if (format === 'MDY') {
    month = p1; day = p2; year = p3;
  } else if (format === 'DMY') {
    day = p1; month = p2; year = p3;
  } else {
    return null; // format is required by the wizard; no guessing here.
  }

  if (String(year).length <= 2) year = expandTwoDigitYear(year);

  return isValidYmd(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

// ---------- Amount parsing ----------

// Strips currency symbols, thousands separators, and converts
// parenthesized-negative accounting format (e.g. "(50.00)") to a signed
// number. Returns null (not 0/NaN) if the string isn't a parseable amount,
// so callers can distinguish "zero" from "unparseable".
export function parseAmountString(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  // Strip currency symbols and thousands separators, keep digits/dot.
  s = s.replace(/[^0-9.]/g, '');
  if (!s || !/^\d*\.?\d*$/.test(s) || s === '.') return null;

  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return negative ? -num : num;
}

// Resolves a row's amount + direction given the wizard's amount-mode config.
// columnMapping.amountMode: 'single' | 'debit-credit'.
//   single: columnMapping.amountCol (signed or unsigned) — sign determines
//     direction unless columnMapping.unsignedDirectionCol/Value style isn't
//     used here (this app's normal transactions always have an explicit
//     direction, so a single unsigned column with no sign is ambiguous and
//     gets flagged rather than guessed).
//   debit-credit: columnMapping.debitCol / columnMapping.creditCol — exactly
//     one of the two must be populated (non-blank, non-zero) per row.
// Returns { amount: number|null, direction: 'in'|'out'|null, issues: string[] }.
export function deriveAmountAndDirection(row, columnMapping) {
  const issues = [];
  const { amountMode } = columnMapping;

  if (amountMode === 'debit-credit') {
    const debitRaw = columnMapping.debitCol != null ? row[columnMapping.debitCol] : '';
    const creditRaw = columnMapping.creditCol != null ? row[columnMapping.creditCol] : '';
    const debit = parseAmountString(debitRaw);
    const credit = parseAmountString(creditRaw);
    const debitPopulated = debit != null && debit !== 0;
    const creditPopulated = credit != null && credit !== 0;

    if (debitPopulated && creditPopulated) {
      issues.push('Both debit and credit are populated for this row.');
      return { amount: null, direction: null, issues };
    }
    if (!debitPopulated && !creditPopulated) {
      issues.push('Neither debit nor credit is populated for this row.');
      return { amount: null, direction: null, issues };
    }
    if (debitPopulated) {
      return { amount: Math.abs(debit), direction: 'out', issues };
    }
    return { amount: Math.abs(credit), direction: 'in', issues };
  }

  // single signed/unsigned column
  const raw = columnMapping.amountCol != null ? row[columnMapping.amountCol] : '';
  const parsed = parseAmountString(raw);
  if (parsed == null) {
    issues.push('Amount could not be parsed.');
    return { amount: null, direction: null, issues };
  }
  if (parsed === 0) {
    issues.push('Amount is zero.');
    return { amount: 0, direction: null, issues };
  }
  if (parsed < 0) {
    return { amount: Math.abs(parsed), direction: 'out', issues };
  }
  // Positive single-column amount with no sign info: this app's transactions
  // always carry an explicit direction, so a strictly-positive value with no
  // separate direction column is ambiguous — flag instead of guessing 'in'.
  if (columnMapping.directionCol != null) {
    const dirRaw = String(row[columnMapping.directionCol] ?? '').trim().toLowerCase();
    if (dirRaw === 'in' || dirRaw === 'credit' || dirRaw === 'deposit') {
      return { amount: parsed, direction: 'in', issues };
    }
    if (dirRaw === 'out' || dirRaw === 'debit' || dirRaw === 'withdrawal') {
      return { amount: parsed, direction: 'out', issues };
    }
    issues.push(`Direction column value "${dirRaw}" not recognized.`);
    return { amount: parsed, direction: null, issues };
  }
  issues.push('Amount is positive but no direction column is mapped; direction is ambiguous.');
  return { amount: parsed, direction: null, issues };
}

// ---------- Draft building ----------

function isBlankRow(row) {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

// Builds one draft per file data row.
//
// columnMapping: {
//   dateCol, dateFormat,            // dateFormat: 'YMD'|'MDY'|'DMY'
//   amountMode,                     // 'single' | 'debit-credit'
//   amountCol, directionCol,        // for 'single' mode
//   debitCol, creditCol,            // for 'debit-credit' mode
//   categoryCol, commentCol, accountCol,
// }
// categoryMapping: Map<rawCategoryString, { name, list, isNew }>
// accountMapping: Map<rawAccountLabel, accountId>
//
// Returns an array of draft objects:
//   {
//     rowIndex, raw: row,
//     date, amount, direction, category, comment, accountId,
//     issues: string[],
//     excluded: boolean,
//   }
export function buildDraftTransactions(rows, columnMapping, categoryMapping, accountMapping) {
  return rows.map((row, rowIndex) => {
    const issues = [];

    if (isBlankRow(row)) {
      return {
        rowIndex,
        raw: row,
        date: null,
        amount: null,
        direction: null,
        category: null,
        comment: '',
        accountId: null,
        issues: ['Row is blank.'],
        excluded: false,
      };
    }

    const rawDate = columnMapping.dateCol != null ? row[columnMapping.dateCol] : '';
    const date = parseDateFlexible(rawDate, columnMapping.dateFormat);
    if (!date) issues.push(`Date "${rawDate}" could not be parsed.`);

    const { amount, direction, issues: amountIssues } = deriveAmountAndDirection(row, columnMapping);
    issues.push(...amountIssues);

    const rawAccountLabel = columnMapping.accountCol != null ? String(row[columnMapping.accountCol] ?? '').trim() : '';
    let accountId = null;
    if (columnMapping.accountCol != null) {
      const mapped = getCI(accountMapping, rawAccountLabel);
      if (mapped == null) {
        issues.push(`Account "${rawAccountLabel}" is not mapped.`);
      } else {
        accountId = mapped;
      }
    } else if (columnMapping.fixedAccountId != null) {
      accountId = columnMapping.fixedAccountId;
    } else {
      issues.push('No account column or fixed account configured.');
    }

    // Category resolution (product-owner DECISION 1 + DECISION 2):
    //   - no category column at all -> Uncategorized, never flagged.
    //   - column mapped but this row's cell is blank -> Uncategorized, never
    //     flagged (product-equivalent to "no column"; flagging one but not
    //     the other would be an inconsistent, confusing distinction).
    //   - column mapped, cell non-blank, but no resolved mapping (user
    //     removed/never set its Step-3 mapping, or it's an unresolved
    //     numeric code per Fix 4) -> hard flag. This is "user gave us a
    //     value and we don't know what to do with it" — still a real error.
    // category is therefore a non-empty string in every non-flagged case,
    // and null ONLY in the hard-flag branch — revalidateBaseDraft's
    // `d.category == null` check depends on exactly this invariant.
    const rawCategory = columnMapping.categoryCol != null ? String(row[columnMapping.categoryCol] ?? '').trim() : '';
    let category = null;
    if (columnMapping.categoryCol == null) {
      category = UNCATEGORIZED;
    } else if (!rawCategory) {
      category = UNCATEGORIZED;
    } else {
      const mapped = getCI(categoryMapping, rawCategory);
      if (mapped == null || mapped.name == null) {
        issues.push(`Category "${rawCategory}" is not mapped.`);
      } else {
        category = mapped.name;
      }
    }

    const comment = columnMapping.commentCol != null ? String(row[columnMapping.commentCol] ?? '').trim() : '';

    return {
      rowIndex,
      raw: row,
      date,
      amount,
      direction,
      category,
      comment,
      accountId,
      issues,
      excluded: false,
    };
  });
}

// ---------- Transfer-pair detection ----------

// Groups drafts by (date, amount) — both required for a match — then within
// each group, pairs opposite-account/opposite-direction drafts. A pair only
// merges when it is a MUTUAL, UNIQUE match (each side has exactly one
// opposite candidate, and that candidate is the other side) — computed once
// over the unmutated group, so the result never depends on array order. Any
// draft with 2+ opposite candidates, or whose single candidate is itself
// contested by another draft, is flagged ambiguous along with everyone else
// touching that contested set; nothing is ever greedily picked.
//
// Runs in O(n) to bucket drafts into same-date/same-amount groups via a Map
// keyed by `${date}|${amount}` (avoiding an O(n^2) nested scan over all
// drafts); the O(n^2)-shaped candidate search below only ever runs within a
// single group, which in practice is a handful of same-date/same-amount rows,
// not the whole file.
//
// Mutates nothing; returns a NEW array where:
//   - successfully-paired drafts are replaced by a single merged
//     { type: 'transfer', ... } draft (carrying issues: [] unless something
//     else about the pair was already flagged),
//   - ambiguous-group drafts keep their original shape but gain an
//     'Ambiguous transfer match' issue,
//   - all other drafts pass through unchanged.
export function detectTransferPairs(drafts) {
  // Only consider drafts that are otherwise structurally sound enough to
  // compare (need a valid date, amount, direction, accountId) and not
  // already excluded by the user.
  const eligible = [];
  const ineligible = [];
  drafts.forEach((d) => {
    if (d.excluded || d.issues.length > 0 || d.date == null || d.amount == null || d.direction == null || d.accountId == null) {
      ineligible.push(d);
    } else {
      eligible.push(d);
    }
  });

  const groups = new Map(); // key: `${date}|${amount}` -> drafts[]
  for (const d of eligible) {
    const key = `${d.date}|${d.amount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  const results = [];

  for (const [, group] of groups) {
    if (group.length < 2) {
      results.push(...group);
      continue;
    }

    // Within the group, every draft needs an "opposite" candidate: different
    // account AND opposite direction (one leg is the 'out' of one account,
    // the other is the 'in' of the other account).
    //
    // Candidate sets are computed once, up front, over the ORIGINAL
    // (unmutated) group — never against a shrinking "used" set — so the
    // result is independent of array order. A pair is only ever merged when
    // it is a mutual, unique match: d has exactly one opposite candidate AND
    // that candidate has exactly one opposite candidate, which must be d
    // back. If either side of a would-be pair has 2+ candidates, every
    // draft touching that contested set is flagged ambiguous and none of
    // them are merged — no greedy picking.
    const candidatesOf = new Map(); // draft -> opposite-candidate drafts[]
    for (const d of group) {
      candidatesOf.set(
        d,
        group.filter(
          (other) =>
            other !== d &&
            other.accountId !== d.accountId &&
            other.direction !== d.direction
        )
      );
    }

    const merged = [];
    const handled = new Set(); // drafts already emitted (paired or ambiguous)

    for (const d of group) {
      if (handled.has(d)) continue;
      const dCandidates = candidatesOf.get(d);

      if (dCandidates.length === 0) {
        // No opposite-side candidate at all — not a transfer, leave as a
        // normal draft untouched.
        results.push(d);
        handled.add(d);
        continue;
      }

      if (dCandidates.length === 1) {
        const other = dCandidates[0];
        const otherCandidates = candidatesOf.get(other);
        if (otherCandidates.length === 1 && otherCandidates[0] === d) {
          // Mutual, unique match on both sides — clean pair.
          const outLeg = d.direction === 'out' ? d : other;
          const inLeg = d.direction === 'out' ? other : d;
          merged.push({
            type: 'transfer',
            date: outLeg.date,
            from_account_id: outLeg.accountId,
            to_account_id: inLeg.accountId,
            amount: outLeg.amount,
            comment: outLeg.comment || inLeg.comment || '',
            issues: [],
            excluded: false,
            sourceRowIndexes: [outLeg.rowIndex, inLeg.rowIndex],
          });
          handled.add(d);
          handled.add(other);
          continue;
        }
      }

      // Either d itself has 2+ candidates, or d's single candidate is
      // contested by someone else (that candidate has 2+ candidates of its
      // own). Either way, d is part of an ambiguous situation.
      results.push({ ...d, issues: [...d.issues, 'Ambiguous transfer match: multiple same-date/same-amount candidates.'] });
      handled.add(d);
    }

    results.push(...merged);
  }

  return [...results, ...ineligible];
}
