import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../api/client.js'
import { getModalRoot } from '../../utils/modalRoot.js'

const CONFIRM_PHRASE = 'DELETE'

// Two-step, high-friction confirmation for an irreversible, destructive
// action (wiping every transaction row across both accounts). Mirrors the
// portal/overlay/panel conventions of TransactionModal.jsx exactly
// (.modal-overlay / .modal-panel), so it looks and behaves consistently
// with every other modal in the app.
//
// Security-critical invariant: there is no code path that fires the delete
// without the typed phrase exactly matching CONFIRM_PHRASE. The final button
// is a real `disabled` button (blocks mouse AND keyboard activation), the
// step-2 form's onSubmit re-checks the phrase before doing anything (so
// Enter can't bypass the disabled attribute), and "Continue" on step 1 only
// advances the step — it never calls the API. The typed value is reset
// whenever the modal is reopened or stepped back to step 1, so navigating
// back and forward can never carry forward a previously-typed, since-changed
// "valid" state.
export default function ClearHistoryModal({ onClose, onCleared }) {
  const [step, setStep] = useState(1)
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const phraseMatches = typed === CONFIRM_PHRASE

  function goToStep2() {
    // Continue only advances the step. It must never itself delete anything.
    setError(null)
    setStep(2)
  }

  function goBackToStep1() {
    // Reset the typed value going back, so forward-again can't reuse a
    // stale/bypassed gate state.
    setTyped('')
    setError(null)
    setStep(1)
  }

  async function fireDelete() {
    // Defense in depth: re-check the gate here too, not just via the
    // disabled attribute on the button and the form's onSubmit guard.
    if (typed !== CONFIRM_PHRASE || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.deleteAllTransactions()
      onCleared(result)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault()
    if (!phraseMatches || submitting) return
    fireDelete()
  }

  const portalTarget = getModalRoot()

  return createPortal(
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Clear all transaction history</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={submitting}>×</button>
        </div>

        {step === 1 ? (
          <>
            <div className="clear-history-warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>This action is irreversible.</strong>
                <ul>
                  <li>Deletes every transaction across <strong>both accounts</strong> (Spending and Savings).</li>
                  <li>Both account balances will return to $0.00.</li>
                  <li>Categories and budgets are <strong>not</strong> affected and will remain exactly as they are.</li>
                </ul>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-danger" onClick={goToStep2}>Continue</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleFormSubmit}>
            <div className="clear-history-warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <p style={{ margin: 0 }}>
                  Type <strong>{CONFIRM_PHRASE}</strong> below to permanently delete all transaction history.
                </p>
                <label className="form-field clear-history-confirm-input">
                  Confirmation phrase
                  <input
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={CONFIRM_PHRASE}
                    autoComplete="off"
                    autoFocus
                    disabled={submitting}
                  />
                </label>
              </div>
            </div>

            {error && <span className="error-text" role="alert">{error}</span>}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={goBackToStep1} disabled={submitting}>Back</button>
              <button type="submit" className="btn-danger" disabled={!phraseMatches || submitting}>
                {submitting ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    portalTarget
  )
}
