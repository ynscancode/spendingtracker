import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { api } from '../../api/client.js'
import { useCategories } from '../../contexts/categories.js'
import { ACCOUNTS } from '../../constants/categories.js'
import { buildDraftTransactions, detectTransferPairs, uniqueValues, UNCATEGORIZED } from '../../utils/importTransforms.js'
import { guessColumnMapping } from './guessColumnMapping.js'
import { STEPS, STEP_LABELS } from './importWizardSteps.js'
import Step1Upload from './Step1Upload.jsx'
import Step2Columns from './Step2Columns.jsx'
import ImportSuggestAI from './ImportSuggestAI.jsx'
import Step3Values from './Step3Values.jsx'
import { buildInitialAccountMapping, buildInitialCategoryMapping } from './buildInitialMappings.js'
import Step4Review from './Step4Review.jsx'
import Step5Confirm from './Step5Confirm.jsx'

// Re-derives { headers, rows } from the raw grid at a given 1-based
// dataStartRow (header row is dataStartRow - 1). Shared between
// handleParsed (offset 1, the default) and setDataStartRow (any offset the
// user picks), so there is exactly one code path for "headers/rows as a
// function of the grid + offset" — avoids drift between the two call sites.
function deriveGridView(grid, dataStartRow) {
  const headerRow = Math.max(0, dataStartRow - 1)
  const headers = (grid[headerRow] ?? []).map(String)
  const rows = grid.slice(dataStartRow)
  return { headers, rows }
}

function initialState() {
  return {
    stepIndex: 0,
    headers: [],
    rows: [],
    // Full rectangular grid as returned by the server's parseFile (header
    // row included), kept around so the "data starts on row __" control can
    // re-derive headers/rows at a different offset without a re-upload.
    rawGrid: [],
    // 1-based index of the first DATA row; the header row is dataStartRow-1.
    // Default 1 reproduces today's behavior (header=row0, data=row1+).
    dataStartRow: 1,
    fileName: null,
    columnMapping: {
      dateCol: null,
      dateFormat: null,
      amountMode: 'single',
      amountCol: null,
      directionCol: null,
      debitCol: null,
      creditCol: null,
      categoryCol: null,
      commentCol: null,
      accountCol: null,
      fixedAccountId: ACCOUNTS.SPENDING,
      // 'single' | 'multiple' — lives inside columnMapping (not a sibling
      // top-level field) so it travels with the rest of the column config
      // and is naturally preserved/reset together. Deriving this from
      // accountCol==null instead would be ambiguous: accountCol==null is
      // ALSO the legitimate "multiple accounts, but the user hasn't picked
      // the account column yet" state. An explicit field disambiguates
      // "I declared single-account" from "I haven't mapped it yet."
      accountScope: 'single',
    },
    categoryMapping: new Map(),
    accountMapping: new Map(),
    // Raw category/account suggestion arrays from a successful AI suggestion,
    // held here only until proceedToValues() consumes them into the Maps
    // above (the same seam buildInitialCategoryMapping/buildInitialAccountMapping
    // feed) — never read by anything downstream of Step 3.
    aiCategorySuggestion: null,
    aiAccountSuggestion: null,
    baseDrafts: [], // unmerged, one per file row, stable `row-${rowIndex}` keys —
    // this is where user edits/exclusions in Review are applied. Populated
    // entering Review; never holds a merged transfer entry.
    drafts: [], // rendered/committed drafts: baseDrafts run through
    // recomputeDrafts (per-row issue re-validation + detectTransferPairs).
    // Derived from baseDrafts on every entry to Review and on every
    // edit/exclude, so transfer detection always reflects the latest edits.
    submitting: false,
    submitError: null,
    result: null,
  }
}

// Re-validates a single unmerged base draft's own fields (date/amount/
// direction/category/account presence) — the same local checks `updateDraft`
// used to do inline. Does NOT touch transfer-ambiguity flags; that's
// detectTransferPairs's job, run afterward over the whole set.
//
// Category rule (per product-owner DECISION 1 point 7): flag ONLY when
// d.category is null. buildDraftTransactions already resolves category to a
// non-empty string ("Uncategorized" or a real mapped name) in every
// non-error case — no category column, or a blank cell, both fall back to
// Uncategorized WITHOUT an issue at build time. null is reserved exactly for
// "the user gave us a non-blank raw value and we have no resolved mapping
// for it" (unmapped raw string, or an unresolved numeric code per Fix 4).
// This MUST be expressed as a function of the resolved d.category field
// (null vs string), not the build-time issue list, since recomputeDrafts
// rebuilds issues from scratch on every edit via this function.
function revalidateBaseDraft(d) {
  const issues = [];
  if (d.date == null) issues.push('Date is required.');
  if (d.amount == null || d.amount <= 0) issues.push('Amount must be a positive number.');
  if (d.direction !== 'in' && d.direction !== 'out') issues.push('Direction is required.');
  if (d.category == null) issues.push('Category is required.');
  if (d.accountId == null) issues.push('Account is required.');
  return { ...d, issues };
}

// Single source of truth for turning the user's per-row edits/exclusions
// (held on baseDrafts) into the rendered/committed draft set: re-validate
// each base row's own fields, then re-run detectTransferPairs over the
// result so transfer merge/ambiguous-flag status always reflects the latest
// edits — never just patched in place from a stale merged view.
function recomputeDrafts(baseDrafts) {
  const revalidated = baseDrafts.map((d) => (d.excluded ? d : revalidateBaseDraft(d)));
  return detectTransferPairs(revalidated).map((d, i) => ({
    ...d,
    key: d.key || `transfer-${i}-${d.sourceRowIndexes?.join('-') ?? i}`,
  }));
}

function columnMappingIsComplete(mapping) {
  if (mapping.dateCol == null || !mapping.dateFormat) return false
  // Category column is optional (Fix 2 — no-category-column rows fall back
  // to "Uncategorized" rather than being required up front).
  if (mapping.accountScope === 'multiple') {
    if (mapping.accountCol == null) return false
  } else if (mapping.fixedAccountId == null) {
    return false
  }
  if (mapping.amountMode === 'single') {
    return mapping.amountCol != null
  }
  return mapping.debitCol != null && mapping.creditCol != null
}

export default function ImportModal({ onClose, onImported }) {
  const { outgoingFor, incomingFor, colorFor: ctxColorFor } = useCategories()
  const [state, setState] = useState(initialState)
  const panelRef = useRef(null)
  const bodyRef = useRef(null)

  const outgoingNames = useMemo(() => outgoingFor(ACCOUNTS.SPENDING).map((c) => c.name), [outgoingFor])
  const incomingNames = useMemo(() => incomingFor(ACCOUNTS.SPENDING).map((c) => c.name), [incomingFor])

  // Focus the new step's first control on every step change. Scoped to the
  // step body (not the whole panel) so it never lands on the header's "x"
  // Close button, which is the first button in panel DOM order.
  useEffect(() => {
    const firstInput = bodyRef.current?.querySelector('input, select, button')
    firstInput?.focus()
  }, [state.stepIndex])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusables = panel.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const step = STEPS[state.stepIndex]

  function goTo(stepName) {
    setState((s) => ({ ...s, stepIndex: STEPS.indexOf(stepName) }))
  }

  function handleParsed(data, fileName) {
    // Tolerate a server response that hasn't been restarted to pick up the
    // grid field yet (older deploy still returns only { headers, rows }):
    // synthesize a grid from headers+rows so the wizard degrades gracefully
    // instead of crashing on data.grid[...] being undefined. At offset 1 this
    // produces an identical view to the old { headers, rows } behavior; the
    // data-start-row control still works, it just operates over the
    // reconstructed grid (so re-detecting an in-file legend row requires a
    // server that actually returns the real grid).
    const grid = data.grid && data.grid.length ? data.grid : [data.headers ?? [], ...(data.rows ?? [])]
    // Derive headers/rows from the raw grid at the default offset (1) rather
    // than using data.headers/data.rows directly — they're equal at offset 1,
    // but going through the same helper setDataStartRow uses keeps there to
    // exactly one code path for "headers/rows as a function of the grid +
    // offset."
    const { headers, rows } = deriveGridView(grid, 1)
    const columnMapping = {
      ...guessColumnMapping(headers),
      fixedAccountId: ACCOUNTS.SPENDING,
      accountScope: 'single',
    }
    setState((s) => ({
      ...s,
      headers,
      rows,
      rawGrid: grid,
      dataStartRow: 1,
      fileName,
      columnMapping,
      stepIndex: STEPS.indexOf('columns'),
    }))
  }

  // Re-derives headers/rows from rawGrid at a new data-start-row offset, and
  // RE-RUNS guessColumnMapping on the new headers — the whole point of this
  // control is that a wrong header row (e.g. a legend/title row above it)
  // means wrong column guesses, so the guess must be redone against the
  // corrected headers. Preserves the user's fixedAccountId/accountScope
  // (those aren't a function of header content). RESETS the downstream
  // value maps + AI stashes since they were keyed on raw cell values read
  // under the OLD header interpretation — a stale Map with size>0 would
  // otherwise suppress the fresh buildInitialCategoryMapping/
  // buildInitialAccountMapping call in proceedToValues.
  function setDataStartRow(n) {
    setState((s) => {
      const { headers, rows } = deriveGridView(s.rawGrid, n)
      const columnMapping = {
        ...guessColumnMapping(headers),
        fixedAccountId: s.columnMapping.fixedAccountId,
        accountScope: s.columnMapping.accountScope,
      }
      return {
        ...s,
        dataStartRow: n,
        headers,
        rows,
        columnMapping,
        categoryMapping: new Map(),
        accountMapping: new Map(),
        aiCategorySuggestion: null,
        aiAccountSuggestion: null,
      }
    })
  }

  function setColumnMapping(next) {
    setState((s) => ({ ...s, columnMapping: next }))
  }

  function setCategoryMapping(next) {
    setState((s) => ({ ...s, categoryMapping: next }))
  }

  function setAccountMapping(next) {
    setState((s) => ({ ...s, accountMapping: next }))
  }

  // Handles a successful AI suggestion (ImportSuggestAI.onResult) or its
  // null/failure case. This is the ONLY place an AI suggestion touches
  // state — it writes into the exact same prefill seams the deterministic
  // path uses (columnMapping for Step 2, the raw arrays consumed by
  // proceedToValues for Step 3's Maps), never anything downstream of Step 3.
  function applyAiSuggestion(suggestion) {
    if (!suggestion) return // silent fallback — deterministic prefill already in place, untouched
    setState((s) => {
      const columnMapping = {
        ...s.columnMapping,
        ...suggestion.columnMapping,
        // The LLM contract never proposes fixedAccountId or accountScope
        // (whole-file-fixed-account / single-vs-multiple scope are
        // deterministic/manual-only concepts) — keep whatever the wizard
        // already has rather than letting either be clobbered.
        fixedAccountId: s.columnMapping.fixedAccountId,
        accountScope: s.columnMapping.accountScope,
      }
      // Defensive: an LLM-proposed accountCol is unwanted in single mode —
      // force it back to null so a future/odd LLM payload can't leak an
      // account column into a file the user has explicitly declared single-
      // account.
      if (columnMapping.accountScope === 'single') {
        columnMapping.accountCol = null
      }
      return {
        ...s,
        columnMapping,
        aiCategorySuggestion: suggestion.categoryMapping,
        aiAccountSuggestion: suggestion.accountMapping,
      }
    })
  }

  function proceedToValues() {
    setState((s) => {
      // Case-insensitive collapse via the SAME uniqueValues() Step3Values.jsx
      // uses to render the value-mapping rows — NOT a plain Set. A plain Set
      // would let two differently-cased spellings of a brand-new category
      // (e.g. "NewCat" / "newcat") seed TWO categoryMapping entries with two
      // different isNew names; handleCommit's categoriesToCreate dedupes by
      // lowercased name and creates only ONE DB row, but the transaction
      // drafts would still carry the other casing verbatim, which
      // categoryService's case-SENSITIVE match rejects — rolling back the
      // whole atomic commit batch. Using uniqueValues() here means the SEED
      // layer collapses casing exactly the way the DISPLAY layer (Step 3) and
      // the LOOKUP layer (buildDraftTransactions's getCI) already do, so a
      // row's category/account resolves to the one casing that actually gets
      // a Map entry (and the one category that actually gets created).
      const rawCategories = uniqueValues(s.rows, s.columnMapping.categoryCol)
      const rawAccounts = uniqueValues(s.rows, s.columnMapping.accountCol)
      const categoryMapping =
        s.categoryMapping.size > 0
          ? s.categoryMapping
          : s.aiCategorySuggestion
          ? new Map(s.aiCategorySuggestion.map((c) => [c.raw, { name: c.name, list: c.list, isNew: c.isNew }]))
          : buildInitialCategoryMapping(rawCategories, [...outgoingNames, ...incomingNames])
      const accountMapping =
        s.accountMapping.size > 0
          ? s.accountMapping
          : s.aiAccountSuggestion
          ? new Map(s.aiAccountSuggestion.map((a) => [a.raw, a.accountId]))
          : buildInitialAccountMapping(rawAccounts)
      return { ...s, categoryMapping, accountMapping, stepIndex: STEPS.indexOf('values') }
    })
  }

  function proceedToReview() {
    setState((s) => {
      const built = buildDraftTransactions(s.rows, s.columnMapping, s.categoryMapping, s.accountMapping)
      const baseDrafts = built.map((d) => ({ ...d, key: `row-${d.rowIndex}`, excluded: false }))
      return { ...s, baseDrafts, drafts: recomputeDrafts(baseDrafts), stepIndex: STEPS.indexOf('review') }
    })
  }

  // Edits always apply to baseDrafts (the unmerged, per-row set) — never to
  // the rendered `drafts` directly — then the whole rendered set is
  // recomputed from baseDrafts via recomputeDrafts. This guarantees
  // detectTransferPairs always re-runs against the user's latest edits, so
  // narrowing an ambiguous group to one candidate auto-pairs immediately
  // instead of silently committing as a normal transaction.
  //
  // `key` here is the draft key as rendered in Review. For a non-transfer
  // draft that's also its baseDraft key (`row-${rowIndex}`) directly. A
  // merged transfer draft has no single baseDraft row to patch against (it
  // has none of this UI's editable fields — Review only allows excluding a
  // transfer draft, never editing its fields), so patches against a
  // transfer-typed key are not expected here.
  function updateDraft(key, patch) {
    setState((s) => {
      const baseDrafts = s.baseDrafts.map((d) => (d.key === key ? { ...d, ...patch } : d))
      return { ...s, baseDrafts, drafts: recomputeDrafts(baseDrafts) }
    })
  }

  // Excluding a draft means excluding its underlying base row(s). A merged
  // transfer draft represents TWO base rows (sourceRowIndexes); excluding it
  // must exclude both legs, or the un-excluded leg would re-enter detection
  // as a lone, suddenly-unmatched candidate.
  function excludeDraft(key) {
    setState((s) => {
      const target = s.drafts.find((d) => d.key === key)
      const rowIndexesToExclude =
        target?.type === 'transfer' ? target.sourceRowIndexes ?? [] : [target?.rowIndex]
      const baseDrafts = s.baseDrafts.map((d) =>
        rowIndexesToExclude.includes(d.rowIndex) ? { ...d, excluded: true } : d
      )
      return { ...s, baseDrafts, drafts: recomputeDrafts(baseDrafts) }
    })
  }

  const flaggedCount = state.drafts.filter((d) => !d.excluded && d.issues.length > 0).length
  const canConfirm = state.drafts.length > 0 && flaggedCount === 0

  async function handleCommit() {
    setState((s) => ({ ...s, submitting: true, submitError: null }))
    try {
      // Collect categories that need creating before commit: (a) every
      // distinct (account, list) pair that actually fell back to
      // Uncategorized among committed drafts, and (b) every Step-3
      // "+ Create new" entry, with account_id following the ROW it actually
      // applies to — NOT a hardcoded ACCOUNTS.SPENDING, which was the latent
      // bug here (a Step-3 "new category" entry is keyed by raw VALUE, not
      // by account, so under multi-account scope the same raw category
      // string can appear on rows routed to either account; the create must
      // follow each row's resolved accountId, not assume Spending).
      // Dedupe per (account_id, list, lowercased name) — exactly
      // commitImport's own skip-if-exists scope, so re-queuing the same
      // triple across many rows is harmless.
      const categoriesToCreate = []
      const seen = new Set() // `${account_id}|${list}|${lowername}`
      function queueCategory(name, list, account_id) {
        const key = `${account_id}|${list}|${name.toLowerCase()}`
        if (seen.has(key)) return
        seen.add(key)
        categoriesToCreate.push({ name, list, account_id })
      }
      const newNames = new Set(
        [...state.categoryMapping.values()]
          .filter((e) => e.isNew && e.name)
          .map((e) => e.name.toLowerCase())
      )
      for (const d of state.drafts) {
        if (d.excluded || d.type === 'transfer' || d.category == null) continue
        const list = d.direction === 'out' ? 'outgoing' : 'incoming'
        if (d.category === UNCATEGORIZED) {
          queueCategory(UNCATEGORIZED, list, d.accountId) // (a) fallback Uncategorized, per distinct (account,list) actually used
        } else if (newNames.has(d.category.toLowerCase())) {
          queueCategory(d.category, list, d.accountId) // (b) Step-3 "+ Create new", account follows the row
        }
      }

      const transactions = state.drafts
        .filter((d) => !d.excluded)
        .map((d) => {
          if (d.type === 'transfer') {
            return {
              type: 'transfer',
              date: d.date,
              from_account_id: d.from_account_id,
              to_account_id: d.to_account_id,
              amount: d.amount,
              comment: d.comment || undefined,
            }
          }
          return {
            type: 'normal',
            date: d.date,
            account_id: d.accountId,
            direction: d.direction,
            category: d.category,
            amount: d.amount,
            comment: d.comment || undefined,
          }
        })

      const result = await api.commitImport({ categoriesToCreate, transactions })
      setState((s) => ({ ...s, submitting: false, result }))
      onImported?.()
    } catch (err) {
      setState((s) => ({ ...s, submitting: false, submitError: err.message }))
    }
  }

  function handleReset() {
    setState(initialState())
  }

  const portalTarget = document.getElementById('modal-root') || document.body

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel import-modal-panel" onClick={(e) => e.stopPropagation()} ref={panelRef}>
        <div className="modal-head">
          <h2>Import transactions</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="import-steps" role="tablist" aria-label="Import steps">
          {STEPS.map((s, i) => {
            const isActive = i === state.stepIndex
            const isDone = i < state.stepIndex
            return (
              <span key={s} className={`import-step-pill ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} role="tab" aria-selected={isActive}>
                {isDone && <Check size={11} className="step-check" aria-hidden="true" />}
                {i + 1}. {STEP_LABELS[s]}
              </span>
            )
          })}
        </div>

        <div className="import-modal-body" ref={bodyRef}>
          {step === 'upload' && <Step1Upload onParsed={handleParsed} />}

          {step === 'columns' && (
            <>
              <ImportSuggestAI
                headers={state.headers}
                rows={state.rows}
                columnMapping={state.columnMapping}
                onResult={applyAiSuggestion}
              />
              <Step2Columns
                headers={state.headers}
                mapping={state.columnMapping}
                onChange={setColumnMapping}
                rawGrid={state.rawGrid}
                dataStartRow={state.dataStartRow}
                onDataStartRowChange={setDataStartRow}
              />
            </>
          )}

          {step === 'values' && (
            <Step3Values
              rows={state.rows}
              columnMapping={state.columnMapping}
              categoryMapping={state.categoryMapping}
              setCategoryMapping={setCategoryMapping}
              accountMapping={state.accountMapping}
              setAccountMapping={setAccountMapping}
              outgoingNames={outgoingNames}
              incomingNames={incomingNames}
              colorFor={(name) => ctxColorFor(ACCOUNTS.SPENDING, name)}
            />
          )}

          {step === 'review' && (
            <Step4Review drafts={state.drafts} onUpdateDraft={updateDraft} onExcludeDraft={excludeDraft} />
          )}

          {step === 'confirm' && (
            <Step5Confirm submitting={state.submitting} error={state.submitError} result={state.result} />
          )}
        </div>

        <div className="modal-actions">
          {step !== 'upload' && !state.result && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setState((s) => ({ ...s, stepIndex: Math.max(0, s.stepIndex - 1) }))}
              disabled={state.submitting}
            >
              Back
            </button>
          )}

          {step === 'upload' && <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>}

          {step === 'columns' && (
            <button type="button" className="btn" onClick={proceedToValues} disabled={!columnMappingIsComplete(state.columnMapping)}>
              Next
            </button>
          )}

          {step === 'values' && (
            <button type="button" className="btn" onClick={proceedToReview}>
              Next
            </button>
          )}

          {step === 'review' && (
            <button type="button" className="btn" onClick={() => goTo('confirm')} disabled={!canConfirm}>
              Next
            </button>
          )}

          {step === 'confirm' && !state.result && (
            <button type="button" className="btn" onClick={handleCommit} disabled={state.submitting}>
              Confirm import
            </button>
          )}

          {step === 'confirm' && state.result && (
            <>
              <button type="button" className="btn-secondary" onClick={handleReset}>
                Import another file
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    portalTarget
  )
}
