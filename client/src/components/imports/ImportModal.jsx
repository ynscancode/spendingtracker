import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { api } from '../../api/client.js'
import { useCategories } from '../../contexts/categories.js'
import { ACCOUNTS } from '../../constants/categories.js'
import { buildDraftTransactions, detectTransferPairs } from '../../utils/importTransforms.js'
import { guessColumnMapping } from './guessColumnMapping.js'
import { STEPS, STEP_LABELS } from './importWizardSteps.js'
import Step1Upload from './Step1Upload.jsx'
import Step2Columns from './Step2Columns.jsx'
import ImportSuggestAI from './ImportSuggestAI.jsx'
import Step3Values from './Step3Values.jsx'
import { buildInitialAccountMapping, buildInitialCategoryMapping } from './buildInitialMappings.js'
import Step4Review from './Step4Review.jsx'
import Step5Confirm from './Step5Confirm.jsx'

function initialState() {
  return {
    stepIndex: 0,
    headers: [],
    rows: [],
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
function revalidateBaseDraft(d) {
  const issues = [];
  if (d.date == null) issues.push('Date is required.');
  if (d.amount == null || d.amount <= 0) issues.push('Amount must be a positive number.');
  if (d.direction !== 'in' && d.direction !== 'out') issues.push('Direction is required.');
  if (!d.category) issues.push('Category is required.');
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
  if (mapping.categoryCol == null) return false
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
    const columnMapping = { ...guessColumnMapping(data.headers), fixedAccountId: ACCOUNTS.SPENDING }
    setState((s) => ({
      ...s,
      headers: data.headers,
      rows: data.rows,
      fileName,
      columnMapping,
      stepIndex: STEPS.indexOf('columns'),
    }))
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
    setState((s) => ({
      ...s,
      columnMapping: {
        ...s.columnMapping,
        ...suggestion.columnMapping,
        // The LLM contract never proposes fixedAccountId (whole-file-fixed-
        // account is a deterministic/manual-only concept) — keep whatever
        // the wizard already has rather than letting it be clobbered.
        fixedAccountId: s.columnMapping.fixedAccountId,
      },
      aiCategorySuggestion: suggestion.categoryMapping,
      aiAccountSuggestion: suggestion.accountMapping,
    }))
  }

  function proceedToValues() {
    setState((s) => {
      const rawCategories = [...new Set(
        s.rows.map((r) => (s.columnMapping.categoryCol != null ? String(r[s.columnMapping.categoryCol] ?? '').trim() : '')).filter(Boolean)
      )]
      const rawAccounts = [...new Set(
        s.rows.map((r) => (s.columnMapping.accountCol != null ? String(r[s.columnMapping.accountCol] ?? '').trim() : '')).filter(Boolean)
      )]
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
      const categoriesToCreate = []
      const seenNewCategories = new Set()
      for (const entry of state.categoryMapping.values()) {
        if (entry.isNew && !seenNewCategories.has(`${entry.name}|${entry.list}`)) {
          seenNewCategories.add(`${entry.name}|${entry.list}`)
          categoriesToCreate.push({ name: entry.name, list: entry.list, account_id: ACCOUNTS.SPENDING })
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
              <Step2Columns headers={state.headers} mapping={state.columnMapping} onChange={setColumnMapping} />
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
