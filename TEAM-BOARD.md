# TEAM BOARD — Import Wizard Fixes (5 issues)

Shared mesh board for cross-role notes. Append under your role heading. Keep entries dated and concise.

## Task context
Fix 5 reported problems in the CSV/Excel import wizard:
1. Step 2 needs explicit account-scope toggle (Spending-only / both accounts).
2. Category column should be optional (no category -> "Uncategorized", not flag-every-row).
3. Step 3 category VALUE mapping broken for numeric category codes w/ legend.
4. Step 3 account-value list shows too many rows (wrong column detected) + needs explanatory copy.
5. Step 4 flags nearly every row (likely downstream of 1-4 + possible date gap).

Constraints: deterministic/local only (no AI expansion), no DB writes until Confirm,
race-safe category creation, Spending/Savings category independence, transfer-* stay system-managed.

## Notes by role
### engineering-director
- (init) Board created. Routing in progress.

### product-owner
**2026-06-23 — Decisions on issue 2 (optional category) and issue 3 (numeric category codes).**
Read for ground truth: `client/src/utils/importTransforms.js` (`buildDraftTransactions`, `revalidateBaseDraft` in `ImportModal.jsx`), `client/src/components/imports/buildInitialMappings.js`, `client/src/components/imports/Step3Values.jsx`, `server/src/services/categoryService.js`, `server/src/services/importService.js` (`commitImport`'s skip-if-exists category guard).

**DECISION 1 — Category becomes optional, via a per-account "Uncategorized" category.**

1. Name: exactly `"Uncategorized"` (≤30 chars, fits `MAX_NAME_LENGTH`; not in `RESERVED_NAMES`, so `createCategory`/`assertValidName` accept it as-is).
2. Scope/lists: **one `"Uncategorized" per (account, list)`** — i.e. up to 4 rows total across the app's current 2 accounts × 2 lists (Spending/outgoing, Spending/incoming, Savings/outgoing, Savings/incoming), created lazily, only in the lists actually needed. Rationale: categories are strictly list-scoped everywhere else in this app (`isValidNormalCategory` requires `list` to match the transaction's `direction`), so a single cross-list "Uncategorized" would violate that invariant and require a special case. Do not special-case it — treat it as an ordinary non-system, account+list-scoped category that happens to get auto-created.
3. Creation mechanism: **auto-created at commit time**, not pre-seeded by a migration. Reuse the exact mechanism `commitImport` already uses for user-created "new" categories from Step 3 (`categoriesToCreate` array + skip-if-exists guard, case-insensitive, scoped per account+list, inside the same atomic transaction). When the wizard needs Uncategorized for account X / direction-implied-list L and it doesn't already exist for that account+list, add `{ name: 'Uncategorized', list: L, account_id: X }` to `categoriesToCreate` exactly like any other new-category draft. No new server endpoint or migration needed.
4. It is a normal, user-visible, user-deletable category once created (editable in Category Manager like any other) — not a system category. It does NOT go in `RESERVED_NAMES`. If a user later renames or deletes it, that's their call (deletion still blocked by the existing "still in use by N transactions" guard, same as any other category).
5. Determining which list (outgoing/incoming) a given Uncategorized-needing row uses: **driven by the row's resolved `direction`** ('out' -> outgoing Uncategorized, 'in' -> incoming Uncategorized), exactly the same rule `isValidNormalCategory` already applies to every other category. Do not ask the user to pick a list for it.

   **No-category-column case:** when `columnMapping.categoryCol == null` for the whole file, every row gets its account+direction's Uncategorized at draft-build time in `buildDraftTransactions` (`client/src/utils/importTransforms.js`) — i.e. when `columnMapping.categoryCol == null`, skip the "Category is blank" issue entirely and set `category` to a sentinel the pipeline resolves to Uncategorized (see implementation note below), rather than leaving it null and flagging.

   **Blank-cell case (category column IS mapped, this row's cell is empty):** same fallback — **Uncategorized, not flagged.** A blank cell in an otherwise-mapped column is product-equivalent to "this row has no category," which is exactly the case Uncategorized exists for; flagging it as an error while a missing column entirely is not flagged would be an inconsistent, confusing distinction for the user. (Distinguish this from a NON-blank cell whose value has no entry in `categoryMapping` — e.g. user deleted a Step-3 row's mapping or a code that's genuinely unresolved — that remains a hard flag; see point 7.)
6. Implementation note (not prescribing code, just the contract): `buildDraftTransactions` should resolve a row's `category` to a structured placeholder (e.g. `{ name: 'Uncategorized', list: <outgoing|incoming based on direction>, isNew: true }`-shaped, or whatever shape lets `ImportModal.jsx` collect it into `categoriesToCreate` the same way Step 3's `isNew` entries already are) whenever: (a) `categoryCol == null`, or (b) `categoryCol != null` but the row's raw cell is blank. The draft's plain `category` string field (used by `revalidateBaseDraft` and the commit payload) should end up as `"Uncategorized"` in both cases, with the corresponding `{ name: 'Uncategorized', list, account_id }` queued once per distinct (account, list) pair encountered — not once per row — mirroring how Step 3 already dedupes new-category creation.
7. **Exact validation rule (replaces `revalidateBaseDraft`'s blanket `if (!d.category) issues.push('Category is required.')`):**
   - Hard-flag "Category is required" ONLY when `categoryCol != null` AND the row's raw cell is non-blank AND that raw value has no resolved mapping (i.e. the user removed/never set its Step-3 mapping, or it's an unresolved numeric code per Decision 2). This is "user gave us a value and we don't know what to do with it" — still a real error.
   - Never flag when `categoryCol == null` (no category column at all) — falls back to Uncategorized per point 5.
   - Never flag when `categoryCol != null` and the cell is blank — falls back to Uncategorized per point 5.
   - In all non-flagged cases, `d.category` must be a non-empty resolved string (`"Uncategorized"` or a real mapped name) by the time `revalidateBaseDraft` runs — never `null` with no issue, since `commitImport`'s `createTransaction` still requires a category.

**DECISION 2 — Numeric category codes: skip fuzzy matching, force manual mapping. Confirmed, simple/robust approach chosen over in-file legend parsing.**

1. **Rule for "this column is numeric codes":** a category column is treated as numeric-coded when every unique, non-blank raw value in it (the same `uniqueValues()` list `Step3Values.jsx` already computes) matches `/^\d+$/` after trimming (integers only — no decimals, no leading `+`/`-`; a column mixing e.g. `"3"` and `"Groceries"` is NOT numeric-coded and falls through to today's normal fuzzy-match path unchanged). Empty/blank cells are ignored for this check (they're already handled by Decision 1, not Decision 2). A column with zero unique non-blank values doesn't trigger this path either (nothing to map).
2. **When numeric-coded, skip `buildInitialCategoryMapping`'s fuzzy match entirely for that column** — do not call `bestMatch` against `candidateNames` for these raw values. This must be a pre-check in (or ahead of) `buildInitialCategoryMapping` (`client/src/components/imports/buildInitialMappings.js`), gated on the full set of raw values for the column, not per-value (a per-value check would let a column with one stray non-numeric value get partially fuzzy-matched and partially forced-manual, which is more confusing than an all-or-nothing rule).
3. **Default dropdown state for each numeric code: unselected — "— Select a category —".** Do NOT default to "+ Create new: '3'" (today's fallback for an unmatched raw value) and do NOT pre-select any existing category. This requires `Step3Values.jsx`'s category `<select>` to support a genuine empty/unselected state for this path (mirroring the account `<select>`'s existing `value=""` / "— Select an account —" pattern at line ~122-124 of `Step3Values.jsx`), which it does not currently have for categories (today every category row defaults to either a fuzzy match or create-new — never blank). This is a real UI-state change, not just a data change: add an unselected option, and treat "unselected" the same way an unmapped account value is treated today — i.e. `categoryMapping.get(raw)` simply has no usable entry (or an explicit `{ name: null }`/no entry at all) until the user picks one.
4. Each numeric code still gets its own manual-mapping row (one row per unique code, same as today) — the user picks per-code from the existing dropdown (existing category, or "+ Create new") with no auto-suggestion bias. This directly fixes the "create new category named '1'" false default.
5. **In-file legend table parsing (e.g. reading a "1 = Groceries, 2 = Rent" block elsewhere in the file) is explicitly OUT OF SCOPE** — confirmed not pursued. Too fragile/fragile-to-detect-reliably across arbitrary file formats for a single-user local app; manual per-code mapping (4 above) is the permanent, supported path for numeric-coded files, not an interim one.
6. **Yes — if the user wants to skip categorizing a numeric-coded column entirely, Decision 1's Uncategorized path applies.** They simply don't map a category column at all (leave `categoryCol == null` on Step 2), and every row falls back to Uncategorized per Decision 1. This is the correct, already-supported escape hatch; no additional product surface is needed for it. (If they DO map the column but want to bulk-skip specific codes rather than create real categories, that is out of scope for this fix — no "map all to Uncategorized" bulk action is being added; each code still requires an explicit per-row choice, which can itself be an existing or newly-created "Uncategorized" category if the user picks it manually, but that's a manual choice like any other, not a special numeric-code behavior.)

**Category-rules compliance check (both decisions):** Uncategorized respects per-account independence (separate row per account), respects list-scoping (separate row per outgoing/incoming, matching how every other category works), does not collide with `RESERVED_NAMES` (`transfer-in`/`transfer-out`), fits `MAX_NAME_LENGTH` (14 chars), and is created via the existing race-safe skip-if-exists path in `commitImport` — no new DB schema, no new server endpoint, no special-casing in `categoryService.js`. Numeric-code handling is purely a client-side Step 3 prefill/UI change (`buildInitialMappings.js`, `Step3Values.jsx`) — it does not touch the server, the category rules, or the commit path at all; an eventual code that gets manually mapped to "+ Create new" still goes through the exact same `categoriesToCreate` flow as any other new category.

**No end-user decision needed for either issue** — both are fully decidable from the existing app constraints (list-scoping, per-account independence, reserved names, "ASSIST not auto-commit" precedent from the LLM feature) without input from the actual app user.

### tech-lead

**2026-06-23 — Technical design for all 6 fixes (file-by-file). Implementation owner: senior-frontend-dev.**

Guiding principle: minimal, client-side, within existing patterns. Two new `columnMapping` fields only (`accountScope`, plus the data-offset which is a separate top-level state field). Server change is limited to `parseFile` returning one extra field (the raw grid). The deterministic pipeline stays the integrity boundary; the AI path is touched in exactly the spots flagged below and nowhere else.

---

#### Cross-cutting state-shape changes

`ImportModal.initialState()`:
- Add to `columnMapping`: `accountScope: 'single'` (NEW; values `'single' | 'multiple'`). Lives inside `columnMapping` so it travels with the other column config and is naturally preserved/reset together.
- Keep `fixedAccountId: ACCOUNTS.SPENDING` (unchanged default).
- Add NEW top-level state fields (NOT inside columnMapping): `rawGrid: []` and `dataStartRow: 1` (1-based index of the first DATA row; header row is `dataStartRow - 1`). Default `1` reproduces today's behavior (header=row0, data=row1+).

Rationale for `accountScope` inside columnMapping vs derived from `accountCol==null`: deriving it is ambiguous — `accountCol==null` is ALSO the legitimate multi-account "user hasn't picked the account column yet" state. An explicit field disambiguates "I declared single-account" from "I haven't mapped the account column yet," and lets `columnMappingIsComplete` require `accountCol` only in multiple mode.

---

#### FIX 3 — Data-start-row offset (do this FIRST; everything else assumes correct headers)

Chosen approach: **client-side, server returns the raw grid.** parseFile already walks the whole grid; it currently discards everything except `grid[0]` (headers) and `grid.slice(1)` (rows). Returning the grid lets the client re-pick the header row with zero re-upload and zero new endpoint.

1. **`server/src/services/importService.js` `parseFile`** — add `grid` to the return value. Change the final `return { headers, rows };` to `return { headers, rows, grid };` where `grid` is the rectangular string grid. Rectangularize the WHOLE grid up front (every row, header row included) to `width = Math.max(...grid.map(r => r.length))`, then derive `headers = grid[0]`, `rows = grid.slice(1)` from the rectangularized grid so all three are consistent width. Using max-width (not `grid[0].length`) matters because when a legend sits on row 0 the real header row may be WIDER than the legend row — taking width from row 0 is itself part of why a legend file mis-shapes everything. `headers`/`rows` keep their current default-offset meaning so no other caller is affected. The `MAX_IMPORT_ROWS` check stays keyed off data rows (`grid.length - 1`). This is the ONLY server change in this batch.

2. **`client/src/api/client.js`** — no change; `parseImportFile` returns the full JSON body, so `grid` comes through automatically.

3. **`ImportModal.handleParsed(data, fileName)`** — store the grid and derive the view from the default offset. Set `rawGrid: data.grid`, `dataStartRow: 1`, derive `headers`/`rows` from offset 1 (via the helper in #5), and `guessColumnMapping(derivedHeaders)`. Go through the helper rather than using `data.headers` directly so there is one code path (they're equal at offset 1).

4. **`ImportModal` — new handler `setDataStartRow(n)`**: re-derives `headers`/`rows` from `rawGrid` at the new offset, RE-RUNS `guessColumnMapping` on the new headers (the whole point — wrong header row means wrong guesses), preserves the user's `fixedAccountId`/`accountScope`, and RESETS the downstream value maps + AI stashes (they were keyed on raw values from the OLD header interpretation):
   ```
   function setDataStartRow(n) {
     setState((s) => {
       const headerRow = Math.max(0, n - 1);
       const headers = (s.rawGrid[headerRow] ?? []).map(String);
       const rows = s.rawGrid.slice(n);
       const columnMapping = {
         ...guessColumnMapping(headers),
         fixedAccountId: s.columnMapping.fixedAccountId,
         accountScope: s.columnMapping.accountScope,
       };
       return { ...s, dataStartRow: n, headers, rows, columnMapping,
                categoryMapping: new Map(), accountMapping: new Map(),
                aiCategorySuggestion: null, aiAccountSuggestion: null };
     });
   }
   ```
   Resetting `categoryMapping`/`accountMapping` is required so a stale `size>0` map can't suppress the fresh `buildInitialCategoryMapping` in `proceedToValues`.

5. **Helper** `deriveGridView(grid, dataStartRow)` returning `{ headers, rows }`, shared between `handleParsed` and `setDataStartRow` — recommended to avoid drift; inline acceptable.

6. **Offset UI** — top of `Step2Columns.jsx` (it gates everything below it; Step 1 is just the picker). Numeric control "Data starts on row __" bound to `dataStartRow`, plus a 2-3 row preview of `rawGrid` around the chosen header row so the user sees which row becomes the header. New props to `Step2Columns`: `rawGrid`, `dataStartRow`, `onDataStartRowChange`. Validate `1 <= n <= rawGrid.length - 1` (need ≥1 data row); clamp/ignore out-of-range. Copy: "If your file has a legend or title rows above the column headers, set the row your column headers are on."

   - AI-path safety: `ImportSuggestAI` reads `state.headers`/`state.rows`/`state.columnMapping`. `setDataStartRow` updates all three atomically before the user can click Suggest (Suggest is below the offset control in the same Step 2 panel), so the AI preview/payload always reflects the corrected grid. No change to `ImportSuggestAI.jsx`. Do NOT add `accountScope`/`dataStartRow`/`rawGrid` to anything the AI suggestion writes.

---

#### FIX 1 — Account-scope toggle (Step 2)

1. **`ImportModal.initialState`** — `columnMapping.accountScope: 'single'`. Default is single-account regardless of whether `guessColumnMapping` found an `accountCol`. Decision: **always default to single**, do NOT auto-flip to multiple even when a plausible account column is detected. Reason: the reported bug (Fix 5) is precisely a near-unique column being mis-detected as the account column and exploding Step 3; defaulting to multiple re-exposes that. Single is the safe common case (most personal exports are one account). `guessColumnMapping`'s `accountCol` guess still pre-fills the dropdown but is inert until the user switches to multiple.

2. **`Step2Columns.jsx`** — scope toggle (two `pill-btn` buttons, same pattern as `amountMode`) at the top of the mapping grid, under the offset control:
   - "Single account (whole file is one account)" → set `accountScope='single'` AND `accountCol=null` (clear any guessed account column so it can't leak into the draft build).
   - "Multiple accounts (file has an account column)" → set `accountScope='multiple'`.
3. **Single mode UI**: render an "Import all rows into" `<select>` bound to `mapping.fixedAccountId`, options from `ACCOUNT_NAMES` (import it into Step2Columns), `onChange → set('fixedAccountId', Number(v))`. Do NOT render the "Account column" `ColumnSelect`.
4. **Multiple mode UI**: hide the fixed-account select; render the "Account column" `ColumnSelect` (required-styled now). Leave `fixedAccountId` in state untouched (harmless; ignored when `accountCol != null`).
5. **`ImportModal.columnMappingIsComplete`** — require account info per mode:
   ```
   if (mapping.accountScope === 'multiple') { if (mapping.accountCol == null) return false }
   else { if (mapping.fixedAccountId == null) return false }
   ```
   (categoryCol no longer required — see Fix 2 #2.)
6. **`ImportModal.applyAiSuggestion`** — when spreading `suggestion.columnMapping`, re-pin BOTH `fixedAccountId` AND `accountScope` from existing state (LLM contract proposes neither), AND when `s.columnMapping.accountScope === 'single'` force `accountCol: null` after the spread (an LLM-proposed accountCol is unwanted in single mode). These are the ONLY edits to the AI path — purely defensive.
7. **`buildDraftTransactions`** — NO change for this fix; it already honors `fixedAccountId` when `accountCol == null` (lines 227-238), and single mode sets `accountCol=null`.

---

#### FIX 2 — Optional category / "Uncategorized" (per DECISION 1)

Add `export const UNCATEGORIZED = 'Uncategorized'` in `importTransforms.js`; reference it from both the draft builder and the commit collector.

1. **`buildDraftTransactions` (`importTransforms.js`)** — replace the category block (lines 240-251):
   ```
   const rawCategory = columnMapping.categoryCol != null
     ? String(row[columnMapping.categoryCol] ?? '').trim() : '';
   let category = null;
   if (columnMapping.categoryCol == null) {
     category = UNCATEGORIZED;                 // no column at all -> fallback, no flag
   } else if (!rawCategory) {
     category = UNCATEGORIZED;                 // blank cell -> fallback, no flag
   } else {
     const mapped = getCI(categoryMapping, rawCategory); // CI lookup, see Fix 5
     if (mapped == null || mapped.name == null) {
       issues.push(`Category "${rawCategory}" is not mapped.`); // non-blank + unresolved -> hard flag (also covers Fix 4 unselected codes)
     } else {
       category = mapped.name;                 // may be a real name, or "Uncategorized" if user mapped it there
     }
   }
   ```
   Invariant (DECISION 1 point 7): `category` is a non-empty string in every non-flagged case and `null` ONLY in the non-blank-unresolved branch. `direction` is already on the draft; the commit collector derives `list` from it.

2. **`ImportModal.columnMappingIsComplete`** — remove `if (mapping.categoryCol == null) return false`. Category column is optional.

3. **`ImportModal.revalidateBaseDraft`** — replace `if (!d.category) issues.push('Category is required.')` with `if (d.category == null) issues.push('Category is required.')`. CRITICAL: `recomputeDrafts` rebuilds `issues` from scratch on every edit via `revalidateBaseDraft`, so the rule MUST be expressed as a function of the resolved `d.category` field (null vs string), NOT rely on the build-time pushed issue surviving. Because point 1 leaves `category` null exactly and only in the hard-flag case, `category == null ⇒ flag` is precisely DECISION 1 point 7. To produce the better "Category \"X\" is not mapped" message, stash `rawCategory` on the draft and use it here (optional polish; the generic message is acceptable).

4. **`ImportModal.handleCommit` `categoriesToCreate` builder (lines 264-271)** — current code only collects `entry.isNew` from `categoryMapping` with hardcoded `account_id: ACCOUNTS.SPENDING`. Two problems: it ignores Uncategorized fallbacks, and the hardcoded account is wrong once multi-account routes rows to Savings. Replace entirely:
   ```
   const categoriesToCreate = [];
   const seen = new Set(); // `${account_id}|${list}|${lowername}`
   function queueCategory(name, list, account_id) {
     const key = `${account_id}|${list}|${name.toLowerCase()}`;
     if (seen.has(key)) return;
     seen.add(key);
     categoriesToCreate.push({ name, list, account_id });
   }
   const newNames = new Set([...state.categoryMapping.values()]
     .filter(e => e.isNew && e.name).map(e => e.name.toLowerCase()));
   for (const d of state.drafts) {
     if (d.excluded || d.type === 'transfer' || d.category == null) continue;
     const list = d.direction === 'out' ? 'outgoing' : 'incoming';
     if (d.category === UNCATEGORIZED) {
       queueCategory(UNCATEGORIZED, list, d.accountId);          // (a) fallback Uncategorized, per distinct (account,list) actually used
     } else if (newNames.has(d.category.toLowerCase())) {
       queueCategory(d.category, list, d.accountId);             // (b) Step-3 "+ Create new", account follows the ROW (fixes latent multi-account bug)
     }
   }
   ```
   Dedupe is per `(account, list, lowername)` — exactly `commitImport`'s skip-if-exists scope, so re-queuing is harmless even when the server already has the category. Commit is gated on zero flags (`canConfirm`), so iterating non-excluded committed drafts is safe; `direction` is always resolved for committable rows. Transfers skipped (system `transfer-in/out` only).

5. **`Step3Values.jsx` categories empty-state copy** — the `rawCategories.length === 0` branch currently renders `error-text`/`role="alert"` "No category column mapped — go back and map one." That's now WRONG (no category column is valid → Uncategorized). Change to neutral `role="status"`, `var(--muted)`: "No category column mapped — every row will import as 'Uncategorized'." Copy/styling only.

   No server/`categoryService` change. Uncategorized created via the existing race-safe atomic skip-if-exists path (DECISION 1 #3); not in RESERVED_NAMES.

---

#### FIX 4 — Numeric category codes (per DECISION 2)

1. **`buildInitialMappings.js`** — add and export a pre-check, gate the fuzzy path:
   ```
   export function isNumericCodeColumn(rawValues) {
     const nonBlank = rawValues.map(v => String(v ?? '').trim()).filter(Boolean);
     if (nonBlank.length === 0) return false;
     return nonBlank.every(v => /^\d+$/.test(v));
   }
   ```
   At the top of `buildInitialCategoryMapping(rawCategories, candidateNames)`:
   ```
   if (isNumericCodeColumn(rawCategories)) {
     return new Map(rawCategories.map(raw => [raw, { name: null, list: 'outgoing', isNew: false }]));
   }
   ```
   `{ name: null }` is the unselected sentinel: no usable category → Step3 renders unselected, `buildDraftTransactions` sees `mapped.name == null` → "is not mapped" hard flag until the user picks. All-or-nothing per DECISION 2 #2 (gate on the full set, never per-value). No new wiring — the gate lives inside `buildInitialCategoryMapping`, which already receives the full `rawCategories`.

2. **`Step3Values.jsx` category `<select>` unselected state** (mirror the account select at lines 117-130):
   ```
   const isUnselected = entry.name == null && !entry.isNew;
   const selectValue = isUnselected ? '' : (entry.isNew ? CREATE_NEW : entry.name);
   ```
   - Render `{isUnselected && <option value="">— Select a category —</option>}` (present only while unselected, same conditional pattern as accounts).
   - `onChange`: treat `value === ''` as a no-op (can't be re-selected once a real option is chosen, since the placeholder is conditionally removed). `CREATE_NEW` and real-name branches unchanged.
   - Guard the swatch with `!entry.isNew && entry.name != null` (so it doesn't render while unselected); the `isNew` list select already guards correctly.

3. **Interaction with Fix 2 revalidate**: an unselected code → `{ name: null }`; `rawCategory` non-blank → `buildDraftTransactions` pushes "is not mapped" → hard flag (DECISION 1 point 7 / DECISION 2 #3). Picking a category (existing, "+ Create new", or a manual "Uncategorized") sets `mapped.name`, clearing the flag on the next `recomputeDrafts`. Confirm the `mapped.name == null` guard is present in the buildDraft branch (Fix 2 #1).

   No server change. AI path untouched: `buildInitialCategoryMapping` is the deterministic seam only; the AI suggestion bypasses it. Numeric handling is deterministic-only by design (constraint-compliant).

---

#### FIX 5 — Account-value list too long / explanatory copy

Mostly resolved by Fix 1 (single mode hides the list) + Fix 3 (correct header row stops a transaction-id column being mis-guessed as accountCol). Remaining deterministic hardening:

1. **`Step3Values.jsx` `uniqueValues`** — case-insensitive collapse, first-seen casing as the display/Map key:
   ```
   function uniqueValues(rows, colIndex) {
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
   ```
   CONSISTENCY CAVEAT: `buildDraftTransactions` looks up the Map with the per-row trimmed-but-not-lowercased value; a row whose casing differs from first-seen would miss the Map and flag. Fix WITHOUT a broad refactor by case-folding at LOOKUP time. Add a small helper in `importTransforms.js`, used for BOTH account and category lookups:
   ```
   function getCI(map, raw) {
     if (map.has(raw)) return map.get(raw);
     const lower = String(raw).toLowerCase();
     for (const [k, v] of map) if (String(k).toLowerCase() === lower) return v;
     return undefined;
   }
   ```
   Use `getCI(accountMapping, rawAccountLabel)` and `getCI(categoryMapping, rawCategory)` in `buildDraftTransactions`. Keeps collapse and resolution consistent regardless of per-row casing; Step 3 writes / AI stash / `proceedToValues` stay as-is. Safe for categories (digits unchanged; case-equal names should map identically).
   - `proceedToValues`'s `rawCategories`/`rawAccounts` plain-`Set` derivation may slightly over-collect (two casings) but both entries resolve fine via `getCI` — harmless. Mirror the fold there only if you want it tight; not required.

2. **`Step3Values.jsx` Accounts copy + gating** — add under the "Accounts" `<h3>` (replace the muted "One row per unique account label found in the file."): "Map each account label found in your file to Spending or Savings." (`var(--muted)`). Gate the whole Accounts block on `columnMapping.accountScope === 'multiple'`; in single mode render nothing for accounts (or a one-line "All rows import to <fixed account name>." confirmation), since the Step 2 fixed-account select already communicates it.

---

#### FIX 6 — Step 4 re-verify + residual date risk

No Step 4 code change. Once 1-5 land, the flag sources are addressed: blank/no-column categories no longer flag (Fix 2), numeric codes flag only until mapped (Fix 4), the account list is correct/short (Fix 1/5), correct headers fix amount/date column identity (Fix 3).

Residual risks to call out (verify, not fix):
- **Date parse still requires an explicit `dateFormat`** (`parseDateFlexible` returns null for ambiguous numeric dates without one). Unchanged and correct. After Fix 3 corrects the header row and re-runs `guessColumnMapping` (fixing a legend-corrupted `dateCol` guess), the format selector remains a REQUIRED manual step on Step 2. Flag in Step 2 help text. No code change.
- **Transfer detection (`detectTransferPairs`) unaffected** by all six fixes — keys on `(date, amount)` + opposite account/direction over issue-free drafts, ignores `category` entirely. (a) Fix 1 multi-account is what makes cross-account transfers possible at all (single-account files can't pair — expected). (b) Uncategorized rows are eligible like any normal draft; category irrelevant to transfer identity. QA: confirm an Uncategorized row matching another on date+amount+opposite-account still merges (correct). No change.

---

#### AI-path / transfer-detection side-effect summary (constraint compliance)
- `ImportSuggestAI.jsx`: **no edits.** Reads `headers`/`rows`/`columnMapping`, all kept coherent through offset re-derivation.
- `applyAiSuggestion`: **defensive edits only** — re-pin `accountScope` (alongside existing `fixedAccountId` re-pin) and force `accountCol: null` when `accountScope === 'single'`. Prevents an odd/future LLM payload from overriding deterministic-only scope state. No new AI capability.
- Numeric-code detection: deterministic seam (`buildInitialCategoryMapping`) only; AI path bypasses it by design.
- `detectTransferPairs` / `commitImport` (server) / `categoryService` / transfer-* system categories: **untouched.** Uncategorized is an ordinary category via the existing race-safe skip-if-exists path; no new endpoint/migration/schema. DB writes still only at Confirm.

#### Build order for senior-frontend-dev
1. Fix 3 (server `grid` + offset state/handler/UI) — unblocks correct headers.
2. Fix 1 (scope toggle + `columnMappingIsComplete` + `applyAiSuggestion` re-pins).
3. Fix 2 (`buildDraftTransactions` category resolution + `revalidateBaseDraft` rule + `handleCommit` collector + Step3 empty-state copy).
4. Fix 4 (numeric detection + Step3 unselected category state).
5. Fix 5 (case-fold `uniqueValues` + `getCI` lookups + Accounts copy/gating).
6. Fix 6 (verify only).

### senior-frontend-dev

**2026-06-23 — Implemented all 6 fixes per tech-lead's plan, build order 3→1→2→4→5→6. No deviations from the plan; no contradictions found.**

**Files changed:**
- `server/src/services/importService.js` — `parseFile` now rectangularizes the WHOLE grid (header row included) up front to `width = Math.max(...grid.map(r => r.length))`, derives `headers`/`rows` from that rectangularized grid (unchanged meaning/offset for existing callers), and returns a new `grid` field additionally. `MAX_IMPORT_ROWS` check unchanged (still keyed off data rows).
- `client/src/components/imports/ImportModal.jsx` — new top-level state fields `rawGrid: []`, `dataStartRow: 1`; new `columnMapping.accountScope: 'single'` field. New helper `deriveGridView(grid, dataStartRow)` and new handler `setDataStartRow(n)` (re-derives headers/rows, re-runs `guessColumnMapping`, preserves `fixedAccountId`/`accountScope`, resets `categoryMapping`/`accountMapping`/`aiCategorySuggestion`/`aiAccountSuggestion`). `handleParsed` now goes through `deriveGridView` instead of using `data.headers`/`data.rows` directly. `columnMappingIsComplete` now branches on `accountScope` (requires `accountCol` in multiple mode, `fixedAccountId` in single mode) and no longer requires `categoryCol`. `revalidateBaseDraft`'s category rule changed from `if (!d.category)` to `if (d.category == null)` (empty string can't occur post-Fix-2, but the distinction matters conceptually — see rule below). `applyAiSuggestion` now also re-pins `accountScope` (alongside the existing `fixedAccountId` re-pin) and forces `accountCol: null` when the re-pinned `accountScope === 'single'` — the only 2 edits near the AI path, both defensive, exactly as specified. `handleCommit`'s `categoriesToCreate` builder fully rewritten: derives `account_id` from each draft's `d.accountId` (fixes the latent hardcoded-`ACCOUNTS.SPENDING` bug) and `list` from `d.direction`, collects both Step-3 "+ Create new" entries and `Uncategorized` fallbacks, deduped per `(account_id, list, lowercased name)`. New imports: `UNCATEGORIZED` from `importTransforms.js`. Step2Columns/Step3Values JSX call sites updated with new props.
- `client/src/components/imports/Step2Columns.jsx` — new props `rawGrid`, `dataStartRow`, `onDataStartRowChange`; new "Data starts on row" numeric input + 4-row grid preview (highlights the row that will become the header) with the exact help copy specified; new "Account scope" pill toggle (single clears `accountCol`, multiple leaves it); Category column relabeled "(optional)" and no longer `required`; Account column area now conditionally renders either the required `ColumnSelect` (multiple mode) or an "Import all rows into" `<select>` bound to `fixedAccountId` (single mode); small visible (not screen-reader-only) help text added under Date format per Fix 6.
- `client/src/components/imports/Step3Values.jsx` — `uniqueValues` now case-insensitively collapses raw values (first-seen casing kept as display/Map key). Category `<select>` gained a genuine unselected state (`isUnselected = entry.name == null && !entry.isNew`) with a `— Select a category —` placeholder option, mirroring the account select; `onChange` treats `value === ''` as a no-op; swatch now also guards on `entry.name != null`. Category empty-state copy changed from an alarming `error-text`/`role="alert"` to a neutral `role="status"` "every row will import as 'Uncategorized'" message. Accounts section: copy changed to "Map each account label found in your file to Spending or Savings."; the whole block is now gated on `columnMapping.accountScope === 'multiple'` — single mode renders a one-line "All rows import to `<fixed account name>`." confirmation instead.
- `client/src/components/imports/buildInitialMappings.js` — new exported `isNumericCodeColumn(rawValues)` (true iff every unique non-blank value matches `/^\d+$/`, gated on the FULL set per column, never per-value). `buildInitialCategoryMapping` now checks this first and, if true, returns every raw code pre-seeded as `{ name: null, list: 'outgoing', isNew: false }` (the unselected sentinel) instead of running fuzzy match.
- `client/src/utils/importTransforms.js` — new exported `UNCATEGORIZED = 'Uncategorized'` constant; new internal `getCI(map, raw)` case-insensitive Map lookup helper (exact match first, case-insensitive fallback scan), used for BOTH account and category resolution in `buildDraftTransactions`. Category resolution block rewritten per Decision 1/2: `categoryCol == null` → `Uncategorized` (no flag); mapped column + blank cell → `Uncategorized` (no flag); mapped column + non-blank cell + no resolved mapping (`mapped == null || mapped.name == null`, the latter covering Fix 4's unselected numeric codes) → hard flag `Category "<raw>" is not mapped.`, `category` stays `null`. Account resolution now uses `getCI` instead of a plain `Map.get`.

**New state field names:**
- `ImportModal` top-level: `rawGrid` (full rectangular grid from the server, `string[][]`), `dataStartRow` (1-based index of first data row, default `1`).
- `ImportModal.columnMapping.accountScope`: `'single' | 'multiple'`, default `'single'`.
- `server/src/services/importService.js`'s `parseFile` return shape gained a third field, `grid` (full rectangularized `string[][]`, header row included) — `headers`/`rows` are unchanged in meaning and still present, so no existing caller (`importDateXlsxTest.js`, `routes/imports.js`) needed updates; verified `importDateXlsxTest.js` still passes (12/12 assertions) destructuring only `{ headers, rows }`.

**Exact new `revalidateBaseDraft` rule implemented:**
```js
if (d.category == null) issues.push('Category is required.');
```
replacing the old `if (!d.category) issues.push(...)`. This is safe and correct because `buildDraftTransactions` now guarantees `d.category` is always a non-empty string (`"Uncategorized"` or a real mapped name) in every case EXCEPT exactly one: a mapped category column whose cell is non-blank but has no resolved mapping entry (raw value never given a Step-3 mapping, or an unselected numeric code per Fix 4) — only that case sets `category = null`. No-category-column files and blank-cell rows never flag.

**Build result: PASS.**
- `cd client && npm run build` — succeeded, no errors (`vite build`, 1816 modules transformed).
- `cd client && npm run lint` — 2 pre-existing errors in `pages/DashboardPage.jsx` and `pages/TransactionsPage.jsx` (`react-hooks/set-state-in-effect`, calling `loadAll()`/`loadTransactions()` synchronously inside `useEffect`) — confirmed pre-existing, in files I never touched, unrelated to this work. Zero lint errors in any file I changed.
- `cd server && node src/scripts/importDateXlsxTest.js` — 12/12 assertions pass (parseFile's date-normalization behavior unaffected by the grid/rectangularization change).
- `cd server && node src/scripts/importLlmTest.js` — 60/60 assertions pass (confirms the LLM path, which I did not touch beyond the 2 specified defensive re-pins in `applyAiSuggestion`, is unaffected).

**QA should specifically exercise:**
1. **Single-account file** (no account column) — default `accountScope='single'`, Step 2 shows "Import all rows into" select (default Spending), Step 3 Accounts section shows the one-line confirmation only, no account-mapping rows. Commit should route every row to the selected fixed account.
2. **Dual-account file** (has an account column, two distinct labels e.g. "Checking"/"Savings Acct") — switch to "Multiple accounts" on Step 2, confirm `accountCol` select appears and is required (Next disabled until set), Step 3 Accounts section shows one row per unique label (case-insensitive collapse — try varying case on the same label across rows) with the new copy, commit creates transactions split correctly across both accounts, and any "+ Create new" categories used on Savings-routed rows actually get created with `account_id` = Savings (this is the latent-bug fix — explicitly verify a category doesn't silently get created under Spending for a Savings-routed row).
3. **Numeric-code category column** (e.g. values "1", "2", "3" with no legend) — Step 3 category selects should all start UNSELECTED ("— Select a category —"), NOT pre-filled with "+ Create new: '1'". Leaving one unselected should hard-flag that row in Step 4 ("not mapped"); picking a real category or "+ Create new" should clear the flag on next render.
4. **No-category-column file** (`categoryCol` left unmapped) — Step 2 Next should NOT be blocked by missing category column. Step 3 Categories section shows the neutral "every row will import as 'Uncategorized'" status message (not an alert). Step 4 should show zero category-related flags. Commit should create one `Uncategorized` category per (account, list) actually used (verify in Category Manager afterward — should NOT create 4 unconditionally, only the ones actually needed) and verify it lands in the correct list (outgoing vs incoming, per each row's direction).
5. **File with a legend/title row offset** (e.g. row 1 is a title/legend line, row 2 is the real header, row 3+ is data) — confirm the default `dataStartRow=1` initially mis-detects columns (since row 1 is being read as the header), then setting "Data starts on row" to 2 re-derives headers correctly, re-runs the column guesser (verify previously-wrong guesses correct themselves), shows the right row highlighted "(header)" in the preview, and that changing the offset resets any Step-3 mappings already made (expected — by design, since they were keyed against stale raw values).
6. Regression-check a previously-working plain file (single account, mapped category column, header on row 1) end-to-end through commit, to confirm no regression from the `accountScope`/`dataStartRow` additions.

**Cross-role note (addressed, no action needed from backend/DBA):** the `parseFile` return-shape change is additive only (`grid` added, `headers`/`rows` unchanged) — `server/src/scripts/importDateXlsxTest.js` and `routes/imports.js` both still destructure only `{ headers, rows }` or pass through the whole result object respectively, and both were verified working. No DB/schema/migration impact from any of the 6 fixes — `Uncategorized` rides the existing `categoriesToCreate` skip-if-exists path with no server-side change required.

**2026-06-24 — Fix for QA's "case-variant new-category rollback" bug (same root cause as Fix 5, seed layer this time).**

**Root cause confirmed exactly as QA described:** `proceedToValues()` in `ImportModal.jsx` derived `rawCategories`/`rawAccounts` via a plain, non-case-folded `[...new Set(...)]` — the SEED layer. `Step3Values.jsx`'s `uniqueValues()` (DISPLAY layer, Fix 5) and `buildDraftTransactions`'s `getCI()` (LOOKUP layer, Fix 5) already case-folded, but the seed layer didn't, so two casings of a brand-new category each got their own `categoryMapping` entry/isNew name, `handleCommit`'s `categoriesToCreate` created only one DB row (dedupes by lowercased name), and the other casing's drafts failed `categoryService`'s case-sensitive match — rolling back the whole atomic batch.

**Files changed:**
- `client/src/utils/importTransforms.js` — `uniqueValues(rows, colIndex)` is now exported from here (moved out of `Step3Values.jsx`, identical algorithm: case-insensitive collapse, first-seen casing kept as the key) so the SEED layer and DISPLAY layer share one literal implementation — no chance of the two drifting again.
- `client/src/components/imports/Step3Values.jsx` — removed its local `uniqueValues`; now imports the shared one from `importTransforms.js`. No behavior change.
- `client/src/components/imports/ImportModal.jsx` — `proceedToValues()`'s `rawCategories`/`rawAccounts` now built via `uniqueValues(s.rows, s.columnMapping.categoryCol)` / `uniqueValues(s.rows, s.columnMapping.accountCol)` instead of the plain `[...new Set(...)]`. Exact change:
  ```js
  const rawCategories = uniqueValues(s.rows, s.columnMapping.categoryCol)
  const rawAccounts = uniqueValues(s.rows, s.columnMapping.accountCol)
  ```
  This is the only logic change in this file. AI suggestion branch (`s.aiCategorySuggestion`/`s.aiAccountSuggestion`) untouched — `rawCategories`/`rawAccounts` only feed the deterministic `buildInitialCategoryMapping`/`buildInitialAccountMapping` fallback branch, never the AI path.
- `server/src/scripts/importMappingTest.js` — added a new section ("QA bug fix — case-variant spellings of a brand-new category seed ONE entry", 8 assertions) exercising `uniqueValues` → `buildInitialCategoryMapping` → `buildDraftTransactions` end to end on a `"NewCat"/"newcat"/"NEWCAT"` fixture, confirming exactly one `categoryMapping` entry, one name, zero flags, and that the create-dedupe + every draft's category string would pass `categoryService`'s case-sensitive check. Section A's existing Fix-5 test now imports the real `uniqueValues` from `importTransforms.js` instead of a local replica (was duplicated code, now exercises the actual shared function). Total assertions: 40 → 48, all passing.

**Confirmed the casing now collapses consistently across all three layers:** SEED (`proceedToValues`, now via `uniqueValues`) → DISPLAY (`Step3Values.jsx`, via the same `uniqueValues`) → LOOKUP (`buildDraftTransactions`'s `getCI`, unchanged) all key off the identical first-seen-casing string for any given case-insensitive value. Verified not just by the unit-level assertions but by reproducing QA's exact repro against the REAL `commitImport`/DB path (two transaction drafts with `category: 'QaCaseTest2'` / `'qacasetest2'`, built through the actual fixed `uniqueValues` → `buildInitialCategoryMapping` → `buildDraftTransactions` pipeline): commit now succeeds (`{ created: 2, transfersLinked: 0, categoriesCreated: 1 }`), no rollback, exactly one category row created — DB cleaned up afterward, no test data left behind.

**Build/test results:**
- `cd client && npm run build` — PASS, 1816 modules, no errors.
- `cd client && npm run lint` — same 2 pre-existing errors in `DashboardPage.jsx`/`TransactionsPage.jsx` (unrelated, untouched files); zero errors in any file I changed.
- `cd server && node src/scripts/importMappingTest.js` — 48/48 PASS (was 40, +8 new for this bug).
- `cd server && node src/scripts/importDateXlsxTest.js` — 12/12 PASS (no regression).
- `cd server && node src/scripts/importLlmTest.js` — 60/60 PASS (confirms LLM path untouched).
- Real-commit-path repro (one-off script, deleted after use, DB cleaned up): case-variant new-category commit succeeds, zero rollback.

No regressions to Fix 1-6: `Step3Values.jsx`'s rendering is unchanged (same function, just relocated/imported), `getCI`'s lookup logic untouched, `handleCommit`'s `categoriesToCreate` dedupe logic untouched (it was already correct — the bug was purely upstream, in what the drafts contained). AI/LLM path untouched.

**2026-06-24 — Hardening: `handleParsed` no longer crashes on a stale server response missing `data.grid`.** In `client/src/components/imports/ImportModal.jsx`, `handleParsed` now synthesizes `const grid = data.grid && data.grid.length ? data.grid : [data.headers ?? [], ...(data.rows ?? [])]` before calling `deriveGridView(grid, 1)`/storing `rawGrid`, so an older `{headers,rows}`-only server response degrades gracefully (offset-1 view identical to pre-Fix-3 behavior; data-start-row control still works over the reconstructed grid) instead of throwing on `data.grid[...]`. No server/contract change. `cd client && npm run build` — PASS (1816 modules, no errors). `cd server && node src/scripts/importMappingTest.js` — 48/48 PASS (this script exercises the pure helpers, not `handleParsed` itself, which is React-state-coupled; no regression in any path it does cover).

### senior-backend-dev

### qa-engineer

**2026-06-24 — QA verification of all 6 fixes. Tests written: `server/src/scripts/importMappingTest.js` (40 assertions, new), plus regression runs of `importDateXlsxTest.js` (12/12), `importSmokeTest.js` (live server, all pass), `importLlmTest.js` (60/60). Client `npm run build` passes. One NEW bug found and reproduced against the real commit path (see below) — tagged for senior-frontend-dev / tech-lead.**

**Methodology:** read all of product-owner's DECISION 1/2, tech-lead's file-by-file plan, and senior-frontend-dev's changelog before touching code. Read every changed source file in full (`importTransforms.js`, `ImportModal.jsx`, `Step2Columns.jsx`, `Step3Values.jsx`, `buildInitialMappings.js`, `importService.js`) and verified the logic directly, not just the changelog prose. Wrote `server/src/scripts/importMappingTest.js`, importing the client's pure ESM functions directly via `file://` URLs (no React/DOM dependency, confirmed they import cleanly standalone) plus the server's real `parseFile()` in-process. Constructed an in-memory CSV fixture matching the user's reported shape (2 legend rows + real header + numeric category codes "1"/"2"/"3" + an account column with case/whitespace variance: "Spending" / " spending " / "SPENDING") and traced it through the full deterministic pipeline.

**Verdict per user-reported problem:**

1. **Step 2 account-scope toggle (single vs multiple) — FIXED.** Confirmed in `Step2Columns.jsx`: explicit pill toggle, single mode clears `accountCol` and shows a fixed-account `<select>`; multiple mode shows the required `ColumnSelect`. `columnMappingIsComplete` branches correctly on `accountScope` (`ImportModal.jsx` lines 127-131). `applyAiSuggestion` re-pins both `fixedAccountId` and `accountScope`, and forces `accountCol: null` in single mode — read and confirmed in code. Default is `'single'` per Decision (`initialState`, `handleParsed`). Not click-through verified (no browser available to me) — see visual-verification request below.

2. **Optional category -> per-(account,list) Uncategorized at commit — FIXED.** Proven by Section A tests A1/A2 in `importMappingTest.js`: `categoryCol == null` -> every row resolves to `"Uncategorized"` with zero category issues (assertions pass); blank cell in a mapped column -> same fallback, no flag (A2, passes). A3/A3b confirm the one remaining hard-flag case still works: non-blank unmapped raw value, and non-blank value mapped to the Fix-4 `{name:null}` sentinel, both correctly null out `category` and push "is not mapped." `revalidateBaseDraft`'s `d.category == null` rule (read in `ImportModal.jsx` line 105) matches this invariant exactly. `handleCommit`'s `categoriesToCreate` collector (read in full) correctly derives `account_id` from `d.accountId` per row (fixes the old hardcoded-Spending bug) and dedupes per `(account_id, list, lowercased name)` — confirmed by code reading; not separately unit-tested in isolation from the rest of `handleCommit`, but the underlying `commitImport` race-safe skip-if-exists path is covered by `importSmokeTest.js` steps 4/5 (still passing).

3. **Data-start-row offset for in-file legend — FIXED.** Section B of `importMappingTest.js`: built a real in-memory CSV with 2 legend rows (narrower than the real header) above the actual header+data. Confirmed `parseFile`'s return is additive (`grid` present alongside unchanged `headers`/`rows`), confirmed the rectangularization takes the WIDEST row's width (5, from the real header) not the first row's width (the bug this specifically fixes), and confirmed client-side `deriveGridView` at `dataStartRow=3` correctly re-derives the real header row and exactly 3 data rows, skipping both legend rows. All assertions pass.

4. **Numeric category codes skip fuzzy match + unselected dropdown state — FIXED.** `isNumericCodeColumn` and `buildInitialCategoryMapping` tested directly: an all-digit column ("1","2","3","10") pre-seeds every entry as `{name:null, isNew:false}` (the unselected sentinel), confirmed NOT `{isNew:true, name:"1"}` (the old bug). A mixed column ("3","Groceries") correctly falls through to normal fuzzy matching (Groceries still matches; "3" still gets ordinary create-new treatment, not the numeric path) — confirms the all-or-nothing gate from Decision 2 #2. `Step3Values.jsx` read and confirmed: `isUnselected = entry.name == null && !entry.isNew` renders a genuine "— Select a category —" placeholder, `onChange` no-ops on `value===''`. Not click-through verified in a browser.

5. **Step 3 account list showing every row + explanatory copy — FIXED.** Section A "Fix 5" test: `["Spending"," spending ","SPENDING"]` collapses to exactly 1 label via the case-insensitive `uniqueValues` algorithm (verified by replicating `Step3Values.jsx`'s documented algorithm directly, since it's component-internal and not separately exported) — confirms this was the root cause of "every row" when casing/whitespace varied. Additionally confirmed via `getCI` that `buildDraftTransactions` resolves ALL THREE casing variants to the same accountId with zero "not mapped" flags — the lookup-side consistency half of the fix, also read and confirmed correct in `importTransforms.js`. Section C repeats this end-to-end against the full legend+numeric-code+case-variant fixture: 3 case-variant account rows in the file collapse to exactly 1 row in the would-be Step 3 list, not "every row." `Step3Values.jsx`'s Accounts block is correctly gated on `accountScope === 'multiple'` (read and confirmed) and the explanatory copy is in place ("Map each account label found in your file to Spending or Savings."). Single-mode confirmation copy ("All rows import to <account>.") also confirmed present.

6. **Step 4 stops flagging once 1-5 are correct — FIXED (verify-only, as planned).** Section C's full pipeline trace produces exactly zero issues across all 3 rows once: category column manually mapped (numeric codes resolved), account resolved via case-insensitive lookup, and an explicit `dateFormat` is set. This confirms Fix 6's claim that no Step-4-specific code change was needed — the flag sources were entirely downstream of 1-5. Residual risk flagged by tech-lead (date format remains a required manual step, no auto-detection) verified still true by reading `Step2Columns.jsx`/`parseDateFlexible` — unchanged, as documented, not a regression.

**Regression checks:**
- `detectTransferPairs` still correctly merges a clean Spending<->Savings pair on matching date+amount, including when both legs resolve to `Uncategorized` (no category column) — confirms Uncategorized rows are transfer-eligible like any other draft, per Fix 6's note. PASS.
- `server/src/scripts/importDateXlsxTest.js` — 12/12 PASS, unaffected by the grid/rectangularization change.
- `server/src/scripts/importSmokeTest.js` — ran against a live server already running on :4000 (did not need to start one myself). All steps PASS: parse (multipart, missing-file 400, header-only-CSV 200, corrupt-xlsx 400), commit-with-new-category, skip-if-exists re-commit, transfer-pair commit (2 linked legs, correct directions/categories), and atomic rollback on a batch with one invalid row mixed in. No regression in the commit/category-creation path from any of the 6 fixes.
- `server/src/scripts/importLlmTest.js` — 60/60 PASS, confirms the AI-suggestion path (touched only by the two specified defensive re-pins in `applyAiSuggestion`) is unaffected.
- `cd client && npm run build` — PASS, 1816 modules, no errors.

**NEW BUG FOUND (not one of the original 5, but introduced/exposed by the Fix-5 case-insensitive account/category handling) — tagged for senior-frontend-dev / tech-lead:**

**Bug: case-variant spellings of a brand-new "+ Create new" category name cause the entire commit batch to fail and roll back**, instead of being treated as the same category. Root cause: `proceedToValues()` in `ImportModal.jsx` derives its `rawCategories` (and `rawAccounts`) via a plain, NOT case-folded `[...new Set(...)]` — this is the exact array passed into `buildInitialCategoryMapping`, which seeds the real `categoryMapping` Map keyed by raw value. If a file has the same new category spelled with different casing across rows (e.g. "NewCat" / "newcat" / "NEWCAT" — plausible in real-world exports with inconsistent casing), each casing becomes its OWN entry in `categoryMapping`, each independently `isNew:true` with `name` set to that row's OWN casing (not normalized to one). `buildDraftTransactions`'s `getCI` lookup then resolves each row's `category` field to ITS OWN raw casing (exact match wins before the case-insensitive fallback runs), so the draft set ends up with 3 different category-name strings for what the user perceives as one category. At commit, `handleCommit`'s `categoriesToCreate` builder DOES correctly dedupe by lowercased name for the create-step (only one DB row gets created, using whichever casing was first-seen) — but the transaction drafts going to `commitImport` still carry the OTHER casings verbatim. `createTransaction` -> `isValidNormalCategory` (`categoryService.js` line ~249) does an exact-string, case-SENSITIVE SQL match (`name = @name`), so any draft whose casing doesn't match the one casing that actually got created throws `ValidationError`, and because `commitImport` wraps the whole batch in one `db.transaction()`, the ENTIRE import fails and rolls back — not just the mismatched rows.

**Reproduced directly against the real `commitImport`/DB** (not simulated): committing `categoriesToCreate: [{name:'QaCaseTest', list:'outgoing', account_id:1}]` plus two transaction drafts referencing `category: 'QaCaseTest'` and `category: 'qacasetest'` respectively threw `category "qacasetest" is not valid for direction "out"` and rolled back the whole batch (confirmed atomically — zero leftover rows in the DB afterward, the rollback itself works correctly).

Note this is a narrower variant of the SAME root cause Fix 5 was meant to address for accounts (case-insensitive collapse) but the fix was only applied to `Step3Values.jsx`'s DISPLAY layer (`uniqueValues`) and `buildDraftTransactions`'s LOOKUP layer (`getCI`) — `proceedToValues`'s SEED layer was left non-case-folded, which the tech-lead's plan explicitly called "harmless" for the existing-category case (since fuzzy match collapses all casings onto the same real name regardless) but did not consider the new-category case, where there is no existing name to collapse onto. Likelihood in practice: moderate — requires a file where a genuinely new category appears with inconsistent casing across rows, which is plausible for hand-edited or multi-source exports (the same shape of bug that triggered Fix 5 for accounts in the first place).

**Suggested fix (for whoever picks this up, not implemented by QA):** case-fold the key in `proceedToValues`'s `rawCategories`/`rawAccounts` Set derivation (mirroring `Step3Values.jsx`'s `uniqueValues`), OR normalize `entry.name` to a single casing across all raw keys that case-fold to the same value before they reach `categoryMapping`. Either closes the gap; the display-layer fix already proves the chosen casing-collapse approach works.

**Tests written (file: `server/src/scripts/importMappingTest.js`, 40 assertions, all passing):**
- buildDraftTransactions: no-category-column fallback (A1, 3 assertions)
- buildDraftTransactions: blank-cell-in-mapped-column fallback (A2, 2 assertions)
- buildDraftTransactions: non-blank unmapped value hard flag (A3, 2 assertions)
- buildDraftTransactions: unselected numeric-code sentinel hard flag (A3b, 2 assertions)
- isNumericCodeColumn / buildInitialCategoryMapping: all-digit column unselected, mixed column normal fuzzy path, empty/blank-only edge cases (8 assertions)
- case-insensitive uniqueValues collapse + getCI lookup consistency (4 assertions)
- detectTransferPairs regression: clean pair still merges with Uncategorized legs (4 assertions)
- parseFile additive grid + legend-offset re-derivation + width-from-widest-row (7 assertions)
- full pipeline trace on user-shaped fixture: legend + numeric codes + case-variant accounts -> zero flags once correctly mapped (8 assertions)

**Not run / not verifiable by me:** actual browser click-through of Step 2/3 UI (toggle buttons, dropdown unselected states, copy rendering, "Data starts on row" preview table) — I have no browser/screenshot tool as a subagent. See visual-verification request below for the specific states that need an actual UI check. Did not separately unit-test `handleCommit`'s React-state-coupled `categoriesToCreate` builder in isolation (it's not a pure function — it reads `state.categoryMapping`/`state.drafts` directly) — covered indirectly by code reading + the `importSmokeTest.js` server-side equivalents (skip-if-exists, transfer commit, rollback-on-invalid-row), which is the closest realistic verification without a browser.

**Confidence: 100% on the verdicts for issues 1-6 as implemented in the reviewed source** (all match the team-board plan, all relevant pure-function paths tested and passing, zero regressions found in existing scripts). New case-variant-new-category bug found is reproduced concretely against the real commit path, not speculative.

## Visual-verification requests
**2026-06-24 — qa-engineer:** I cannot click through the UI myself (no browser/screenshot tool as a subagent). Requesting a visual check of the following specific states introduced by this batch of fixes, since pure-function/server testing can't confirm rendering/interaction correctness:
1. Step 2: the "Account scope" pill toggle — confirm clicking "Single account" hides the Account-column select and shows "Import all rows into" with Spending/Savings options; confirm clicking "Multiple accounts" does the reverse and that Next is disabled until an account column is chosen.
2. Step 2: "Data starts on row" numeric input + the 4-row preview table — confirm the highlighted "(header)" row updates live as the number changes, and that changing it visibly resets Step 3 selections if the user had already gone there and come back.
3. Step 3: a numeric-category-code column — confirm each code's dropdown genuinely renders "— Select a category —" as the visible selected option (not blank/broken), and that picking a real option removes that placeholder permanently (per spec) rather than allowing re-selecting blank.
4. Step 3: the no-category-column neutral status message ("...every row will import as 'Uncategorized'.") renders as plain/neutral styling, not alarming red/alert styling.
5. Step 4: a file mixing case-variant spellings of a brand-new category (e.g. "NewCat" / "newcat" across two rows) — confirm whether Step 3 visually shows this as ONE row or TWO separate rows in the Categories list (this directly determines how visible the new bug above is to a real user before they ever hit the rollback at commit).

### engineering-director — visual-verification attempt + finding (2026-06-24)
Attempted QA's visual-verification request via live browser (Playwright connected; dev app on :5173, server on :4000). Uploaded a constructed fixture matching the user's shape (2 legend rows + numeric category codes 1/2/3 + case-variant account labels "Spending"/" spending "/"SPENDING"/"NewCat") at `vv-test.csv`.

RESULT — Step 1 upload threw a caught error in the UI: "Cannot read properties of undefined (reading '0')". Root-caused: this is NOT a code defect in the worktree. `handleParsed` correctly reads `data.grid` (Fix 3), and the worktree's `parseFile` DOES return `grid` (verified in-process: keys = headers,rows,grid). The error is because the **live server process on :4000 is a stale process started 2026-06-22, predating the importService.js change** — `curl` to :4000/api/imports/parse returns only `{headers, rows}`, no `grid`. The Vite proxy forwards to that stale server, so the new client crashes on `data.grid[...]`. QA's tests passed because they import `parseFile` in-process (fresh code), bypassing the stale server. I could not restart :4000 (sandbox correctly blocked force-killing a process I didn't start this session — the user owns that server).

Two action items from this:
1. **DEPLOY/ENV (no code):** the :4000 server must be restarted to pick up the importService.js `grid` change before the feature works end-to-end in the running app. Flagging for the user — `node --watch` may not have been active on this worktree's server.
2. **HARDENING (small code, routed to senior-frontend-dev):** `handleParsed` hard-depends on `data.grid`. A client paired with a not-yet-restarted older server crashes at Step 1 instead of degrading. Recommend a defensive fallback: `const grid = data.grid ?? (data.headers ? [data.headers, ...data.rows] : [])` (or equivalent) so an older `{headers,rows}`-only response still works (data-start-row offset simply unavailable in that case). Low-risk, deterministic, no AI/contract change.

The 5 UI states QA listed (scope toggle, data-start-row preview, numeric-code unselected dropdown, neutral Uncategorized copy, case-variant single-row collapse) could NOT be visually confirmed because the stale server blocked progress past Step 1. They remain pending a live re-check after the server is restarted + the hardening lands. Code-level verification of all of them stands (QA's 48 assertions + source review).

## Round 2 product decisions (legend side-column + per-account)

**2026-06-24 — product-owner.** Round 1 was built on a WRONG assumption: the "legend" the user describes is a two-column code->name mini-table sitting OFF TO THE SIDE of the real data (e.g. columns H+), not extra header/title rows ABOVE the data. Round 1's "Data starts on row N" control (Fix 3) solves a different, nonexistent problem and is why the user re-tested and saw the same failures. Round 1 also explicitly ruled out legend-parsing (old DECISION 2 point 5) under the WRONG mental model, and never addressed per-account category-vocabulary independence at all — Step 3's `categoryMapping`/`accountMapping` are single global `Map`s applied to every row regardless of which account that row resolves to, which is a second, independent bug given Spending/Savings have fully independent category lists.

These two decisions supersede the OLD "DECISION 2" entry above (numeric-codes-skip-fuzzy-match) only where they conflict; the Uncategorized/optional-category decision (old DECISION 1) is untouched and still correct.

---

### DECISION 1 (round 2) — Legend handling: **Option (a), explicit user-pointed legend-column picker**, with the manual-mapping UI (Option (c)'s ask) also required as a baseline regardless.

**Choice: (a).** The user should be able to point the wizard at the legend's column range in Step 2/3 and have it auto-resolve codes via that legend, once per account.

**Rationale:**
- The user's own language ("my categories legend is... on a column that is further down") shows they already see the legend as a distinct, identifiable structure in their file — they are not asking the wizard to guess at fuzzy heuristics; they're asking it to read the table they can see and point at. (a) matches that mental model directly; (b) (auto-detect) adds non-trivial heuristic risk (distinguishing a legend block from any other small-integer-plus-text two-column region, e.g. account numbers, zip+city, ratings) for a feature this app's threat model doesn't reward speculative guessing in (see CLAUDE.md's repeated "user must explicitly confirm" pattern for the LLM-assist feature — same philosophy applies here: let the user assert ground truth rather than infer it).
- (c) alone was already tried in spirit (round 1's numeric-code-forces-manual-mapping) and the user explicitly reports it is STILL broken ("majority of categories that are asking to create a new category based off just the number") — meaning the manual path itself has a live, separate bug (see Open Question 1 below), not just a UX-speed problem. Shipping (c) alone a second time without first confirming why it's still broken would repeat the same mistake pattern that caused this round 2 conversation.
- (a) is strictly additive on top of the existing Decision-1 numeric-code manual-mapping path (old DECISION 2, points 1-4, kept): if the user has a legend, pointing at it auto-resolves every code in one pass (mapping "once via the file," exactly the efficiency win the user is asking for, given they may have 10-20+ codes). If they don't have a legend, or skip the picker, the existing per-code manual dropdown remains the fallback — so (a) never regresses the no-legend case.
- Implementation complexity is bounded and consistent with the existing pattern: it is a confirmable picker (two `ColumnSelect`s: "Legend code column" + "Legend name column", reusing the existing `ColumnSelect` component already in `Step2Columns.jsx`), not free-form parsing of arbitrary file layout. The legend's row RANGE is derived mechanically (non-blank rows in those two columns, scanned across the full `rawGrid` independent of the main data's row range — the two regions are disjoint by construction once the user points at separate columns) rather than guessed.

**Concrete behavior spec:**
1. Step 2 gains an optional, collapsed-by-default "This file has a category legend" toggle (same `pill-btn` pattern as Account scope/Amount mode). Off by default — does not appear or affect anything unless the user opts in (keeps the common no-legend case untouched, zero regression risk).
2. When on, two new `ColumnSelect`s appear: "Legend code column" and "Legend name column" (both required once the toggle is on), populated from the SAME `headers`/index space as the main `ColumnSelect`s (legend columns are real columns in the same grid — e.g. column H/I — just ones the main data doesn't use).
3. The wizard reads every row of `rawGrid` (not just the main data's row range) where BOTH the code column and name column cells are non-blank, building a `code -> name` lookup. Rows where either cell is blank are skipped (handles a legend shorter than the data, or a ragged region). No requirement that the legend appear in any particular row range relative to the data — it can start on row 1, row 50, anywhere; the picker is column-based, not row-based, exactly matching the user's reported file shape.
4. This lookup is then used to PRE-FILL `buildInitialCategoryMapping`'s per-code Step-3 entries: for each numeric code in the category column, if the legend lookup has an entry for that code, pre-fill `{ name: <legend name>, list: 'outgoing', isNew: false-if-name-matches-existing-category-else-true }` (same fuzzy "does this name already exist as a real category" check the non-numeric path already does via `bestMatch`/exact match — a legend name is just another raw candidate name at that point) instead of the unselected sentinel. Codes with NO legend entry still fall back to the existing unselected-sentinel manual path (old DECISION 2 point 3) — legend coverage is a prefill, not a hard requirement; an incomplete legend never blocks the wizard.
5. **This is still ASSIST, not auto-commit**, consistent with this app's established LLM-suggestion precedent (CLAUDE.md): the legend-derived prefill lands in the SAME editable Step-3 dropdown the user can always override, never directly into a draft's committed `category` field. Step 3 still shows one row per unique code with a real, changeable dropdown value, not a locked/read-only resolved value — same integrity boundary as today.
6. The legend-column picker, the lookup it builds, and the per-account-ness it must respect are coupled to Decision 2 below — see point 4 there for exactly how the legend interacts with per-account scope.

**Acceptance criteria — Decision 1:**
1. GIVEN a file with no legend toggle enabled, WHEN the user completes Step 2/3 as today, THEN behavior is byte-for-byte unchanged from the current numeric-code manual-mapping path (no regression).
2. GIVEN the user enables "This file has a category legend" and selects a code column and a name column, WHEN they reach Step 3, THEN every numeric code present in BOTH the category column AND the legend's code column is pre-filled with the legend's corresponding name (not left unselected, not defaulted to "+ Create new: '<code>'"), and the dropdown remains fully user-editable.
3. GIVEN a code appears in the category column but has NO matching row in the legend's code column, WHEN Step 3 renders, THEN that code falls back to the existing unselected "— Select a category —" state (old DECISION 2 point 3) — never silently dropped, never auto-created.
4. GIVEN the legend's code column and the file's main category column are NOT the same column, WHEN the legend lookup is built, THEN it is built by scanning the FULL `rawGrid` (not limited to the main data's row span), so a legend located anywhere — beside, above, below, or fully disjoint from the transaction rows — resolves correctly.
5. GIVEN a legend name that exactly (case-insensitively) matches an existing category for the resolving account, WHEN pre-filled, THEN the entry is `isNew: false` and uses the existing category's exact stored casing/name (consistent with how the non-numeric fuzzy path already behaves) — it must NOT create a duplicate category differing only by case.
6. GIVEN a legend name that does NOT match any existing category, WHEN pre-filled, THEN the entry is `isNew: true` with `name` = the legend's literal text, list defaulting to `outgoing` (user-editable to `incoming` via the existing list selector) — same as today's manual "+ Create new" flow, just pre-selected instead of requiring the user to type/pick it.
7. GIVEN the user disables the legend toggle after having enabled it (or changes which columns are picked), WHEN Step 3 re-renders, THEN any previously legend-derived mappings are invalidated/reset (same "reset downstream maps" pattern Round 1 already established for `setDataStartRow`) — no stale legend-derived mapping survives a changed or removed legend source.

---

### DECISION 2 (round 2) — Per-account category mapping: **confirmed hypothesis — category mapping must be done ONCE PER ACCOUNT, not globally.** Account dropdown mapping itself (raw label -> Spending/Savings) stays global/single, since an account LABEL means the same account everywhere in one file; it is specifically the CATEGORY vocabulary, and any legend, that must be scoped per resolved account.

**Interpretation of "configure inputs for savings as well":** the user is reporting that once they declare `accountScope: 'multiple'`, the wizard still behaves as if there is only one category vocabulary to map against. Concretely today: `Step3Values.jsx`'s Categories section renders ONE list of unique raw category values, fuzzy-matched/resolved against `outgoingNames`/`incomingNames` — which `ImportModal.jsx` computes ONLY for `ACCOUNTS.SPENDING` (lines 144-145: `outgoingFor(ACCOUNTS.SPENDING)`, hardcoded, never `ACCOUNTS.SAVINGS`). So even before getting to the numeric-code problem, every category dropdown in Step 3 is being populated from Spending's category list ONLY — a Savings-routed row's raw category value is fuzzy-matched against the WRONG account's vocabulary, or (for numeric codes) manually mapped against the wrong account's dropdown options. This is precisely the bug the user is describing, and it is real and independent of the legend issue.

**What does NOT need to be per-account:** the ACCOUNT label mapping itself (`accountMapping`: raw label "Checking"/"Savings Acct" -> accountId). A raw account label resolves to exactly one account for the whole file — it's the routing key, not a vocabulary — so it correctly stays one global map, as today. Only the CATEGORY mapping (and, per Decision 1, the legend lookup) needs splitting per account.

**Concrete behavior spec:**
1. **The category-mapping Map's key changes from `raw category string` to `(accountId, raw category string)`** wherever `accountScope === 'multiple'`. In `single` mode, there is exactly one account for the whole file, so the existing single global map is correct as-is and needs no change (this is the common case — most personal exports are one account, per Round 1's tech-lead note — so this is purely additive complexity gated on multi-account).
2. **Step 3's Categories section, in multi-account mode, is split into one sub-list per account actually present in the resolved data** (i.e. per distinct accountId that `accountMapping` actually routes at least one row to — not unconditionally both Spending AND Savings if the file only ever routes to one of them). Each sub-list is headed by the account name ("Spending categories" / "Savings categories") and is populated from: (a) only the raw category values that appear on rows resolving to THAT account, and (b) a dropdown whose options come from THAT account's own `outgoingFor`/`incomingFor` (via `useCategories()`), not a single shared Spending-only list.
3. **The SAME raw category value can appear in both sub-lists with independently chosen mappings** if it occurs on rows for both accounts (e.g. code "3" -> "Transport" on a Spending row, code "3" -> "Emergency fund" on a Savings row) — this is the core of the bug report and must be representable. The Map key (accountId, raw value) makes this natural; a single global Map keyed on raw value alone cannot represent it (today's implementation literally cannot have two different mappings for "3").
4. **Decision 1's legend is ALSO per-account**, for the same reason: if a legend exists, it must be confirmable that the SAME legend resolves the SAME code consistently for whichever account a row belongs to, OR (if the user's file genuinely uses two different legends/vocabularies per account) the legend picker itself may need to be declared per-account. Resolved scope for this round: **one legend, applied to BOTH accounts' numeric-code resolution**, with the LEGEND'S RESOLVED NAME then separately checked against each account's OWN existing-category list (per Decision 1 points 5/6, run separately per account) to decide `isNew`. This covers the common real-world case (one bank export, one numbering scheme, but the resulting category might already exist under one account and not the other) without requiring the user to define two legends for what is almost always one underlying code scheme. If a file genuinely has two DIFFERENT legends/code schemes per account, that is the one open question below requiring the user's input (Open Question 2) — not decidable from the data model alone.
5. `buildDraftTransactions`'s category-lookup call must resolve each row's `accountId` FIRST (already does, via `accountMapping`/`fixedAccountId`), then look up `(accountId, rawCategory)` in the now-keyed `categoryMapping`/legend lookup — order matters and is already naturally available since `accountId` resolution happens earlier in the same function.
6. `handleCommit`'s `categoriesToCreate` collector (already fixed in Round 1 to derive `account_id` from each draft's row, per old Decision 1 point implementation note) is unaffected in shape — it already iterates per-draft and uses `d.accountId`, so it requires no further change once the per-account Map feeds it correctly-resolved names.

**Acceptance criteria — Decision 2:**
1. GIVEN `accountScope === 'single'`, WHEN the user maps categories in Step 3, THEN behavior is unchanged from today (one flat category list, one account's vocabulary) — no regression for the common single-account case.
2. GIVEN `accountScope === 'multiple'` and the file routes rows to both Spending and Savings, WHEN Step 3 renders, THEN the Categories section shows two clearly headed sub-lists ("Spending categories", "Savings categories"), each populated only with category values that actually occur on that account's rows, each with a dropdown sourced from THAT account's own category list (`outgoingFor(accountId)`/`incomingFor(accountId)`), not a shared/hardcoded Spending-only list.
3. GIVEN the same raw category value (e.g. numeric code "3") occurs on rows for both accounts, WHEN the user maps it differently per account (e.g. "3" -> "Transport" for Spending, "3" -> "Emergency fund" for Savings), THEN both mappings are retained independently and `buildDraftTransactions` resolves each row to the correct account-specific name — verified by at least one drafted Spending row showing "Transport" and one drafted Savings row showing "Emergency fund" for the same source code.
4. GIVEN `accountScope === 'multiple'` and the file routes rows to only ONE of the two accounts (e.g. all rows resolve to Spending despite multi-account being declared), WHEN Step 3 renders, THEN only that one account's sub-list appears — no empty/dead "Savings categories" section is shown.
5. GIVEN a legend (Decision 1) is configured alongside `accountScope === 'multiple'`, WHEN a legend-resolved name already exists as a real category under one account but not the other, THEN the Spending sub-list's entry for that code is pre-filled `isNew: false` (matched) while the Savings sub-list's entry for the SAME code is independently pre-filled `isNew: true` (create), each correctly checked against its own account's category list — proving the per-account existing-category check (point 4 above) is genuinely independent per account, not shared.
6. GIVEN any category gets created at commit via `categoriesToCreate`, WHEN the batch is built, THEN every created category's `account_id` matches the account the triggering ROW actually resolved to (already correct per Round 1's fix to `handleCommit`; this criterion is a regression guard, not new work).

---

### Questions that genuinely require the END USER (not decidable from the data model + bug report alone)

Conservative list — everything else above is decided. Only escalating what truly can't be inferred:

1. **Does the user's actual file have ONE legend/numbering scheme shared across whatever appears in both accounts, or could the SAME numeric code mean entirely different, independently-numbered things on Spending vs. Savings such that ONE legend block cannot resolve both?** Decision 2 point 4 assumes one shared legend (the common case) and handles the "name already exists under one account but not the other" wrinkle without requiring two legends. If the user's real file actually has two distinct legend blocks (one intended for Spending-routed rows, one for Savings-routed rows, with overlapping codes meaning different things even at the LEGEND level, not just at the category-matching level), the picker needs a per-account toggle for the legend source itself (two code/name column pairs instead of one) — a materially bigger UI than Decision 1 specifies. Recommend asking the user directly: "Does your file have one shared code legend, or a separate legend per account?" before building the two-legend variant speculatively.

2. **Confirm the legend's physical column layout assumption.** Decision 1 assumes a simple two-column adjacent (or at least two-distinct-column) `code | name` table, scannable independently of the main data's row range. If the user's actual legend is structured differently (e.g. one column containing both code and name combined as "1 - Groceries" in a single cell, or a multi-column legend with more than 2 fields, or several disjoint legend blocks rather than one contiguous list) the column-picker UI as specified won't fit and needs adjustment. Recommend a quick confirm-by-example: ask the user to paste/describe 3-4 actual rows of their legend block verbatim before implementation starts, since "two-column code->name pairs running down some rows" in the prompt is closely matched but not 100% guaranteed to be the literal cell layout.

Everything else in both decisions (per-account category vocabulary independence, legend-as-assist-not-autocommit, ASCII of how the Map keys/UI split, single-account-mode no-op, fallback-to-manual-when-uncovered) follows directly from the existing data model (CLAUDE.md's categories-are-per-account section) and the user's own verbatim report, and does not need further end-user input.

**Engineering should NOT start building the two-legend variant or a non-two-column legend parser speculatively — build to the single-shared-legend, two-column-adjacent spec above first, and only branch if the user's answers to the two questions above say otherwise.**
