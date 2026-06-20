import { useRef, useState } from 'react'
import { ACCOUNTS, ACCOUNT_NAMES } from '../../constants/categories.js'
import { todayStr } from '../../utils/dateUtils.js'
import { useCategories } from '../../contexts/categories.js'
import CategoryManagerModal from './CategoryManagerModal.jsx'

const TRANSFER_DIRECTIONS = [
  { value: 'savings-to-spending', label: 'Savings -> Spending (topup)', from: ACCOUNTS.SAVINGS, to: ACCOUNTS.SPENDING, defaultComment: 'topup spending from savings' },
  { value: 'spending-to-savings', label: 'Spending -> Savings', from: ACCOUNTS.SPENDING, to: ACCOUNTS.SAVINGS, defaultComment: 'transfer to savings' },
]

function emptyNormalForm(outgoingNames) {
  return { date: todayStr(), account_id: String(ACCOUNTS.SPENDING), direction: 'out', category: outgoingNames[0] || '', amount: '', comment: '' }
}

function emptyTransferForm() {
  return { date: todayStr(), directionKey: TRANSFER_DIRECTIONS[0].value, amount: '', comment: TRANSFER_DIRECTIONS[0].defaultComment, commentTouched: false }
}

// Modal housing both the "Transaction" and "Transfer" tabs, replacing the
// previous inline TransactionForm/TransferForm. Preserves all prior
// validation and behavior (category list filtered by direction, transfer
// default-comment-per-direction with a commentTouched flag so switching
// direction doesn't clobber a comment the user already edited).
export default function TransactionModal({ initialMode = 'normal', onClose, onCreateTransaction, onCreateTransfer }) {
  const { outgoing, incoming } = useCategories()
  const outgoingNames = outgoing.map((c) => c.name)
  const incomingNames = incoming.map((c) => c.name)

  const [mode, setMode] = useState(initialMode)
  const [normalForm, setNormalForm] = useState(() => emptyNormalForm(outgoingNames))
  const [transferForm, setTransferForm] = useState(emptyTransferForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const manageLinkRef = useRef(null)

  const normalCategories = normalForm.direction === 'out' ? outgoingNames : incomingNames
  const selectedTransferDirection = TRANSFER_DIRECTIONS.find((d) => d.value === transferForm.directionKey)
  const transferToName = ACCOUNT_NAMES[selectedTransferDirection.to]

  // Categories load asynchronously after the modal mounts (and can change via
  // the category manager while this modal is open), so the select's value
  // can't just be normalForm.category verbatim: if that category isn't (or
  // isn't yet) in the live list — e.g. list was empty on first render, or the
  // category was just removed — fall back to the live list's first entry
  // without needing an effect to sync state.
  const selectedCategory = normalCategories.includes(normalForm.category)
    ? normalForm.category
    : (normalCategories[0] || '')

  function openManager() {
    setManagerOpen(true)
  }

  function closeManager() {
    setManagerOpen(false)
    manageLinkRef.current?.focus()
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
  }

  function setNormalField(key, value) {
    setNormalForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }

  function handleDirectionChange(direction) {
    const allowed = direction === 'out' ? outgoingNames : incomingNames
    setNormalForm((f) => ({ ...f, direction, category: allowed[0] || '' }))
    setError(null)
  }

  function setTransferField(key, value) {
    setTransferForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }

  function handleTransferDirectionChange(value) {
    const next = TRANSFER_DIRECTIONS.find((d) => d.value === value)
    setTransferForm((f) => ({
      ...f,
      directionKey: value,
      // Only overwrite the comment if the user hasn't manually edited it, so
      // switching direction doesn't clobber a custom comment they typed.
      comment: f.commentTouched ? f.comment : next.defaultComment,
    }))
    setError(null)
  }

  function handleTransferCommentChange(value) {
    setTransferForm((f) => ({ ...f, comment: value, commentTouched: true }))
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    if (mode === 'normal') {
      const amountNum = Number(normalForm.amount)
      if (!amountNum || amountNum <= 0) {
        setError('Amount must be a positive number')
        return
      }
      setSubmitting(true)
      try {
        await onCreateTransaction({
          date: normalForm.date,
          account_id: Number(normalForm.account_id),
          direction: normalForm.direction,
          category: selectedCategory,
          amount: amountNum,
          comment: normalForm.comment,
        })
        onClose()
      } catch (err) {
        setError(err.message)
      } finally {
        setSubmitting(false)
      }
    } else {
      const amountNum = Number(transferForm.amount)
      if (!amountNum || amountNum <= 0) {
        setError('Amount must be a positive number')
        return
      }
      setSubmitting(true)
      try {
        await onCreateTransfer({
          date: transferForm.date,
          from_account_id: selectedTransferDirection.from,
          to_account_id: selectedTransferDirection.to,
          amount: amountNum,
          comment: transferForm.comment,
        })
        onClose()
      } catch (err) {
        setError(err.message)
      } finally {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{mode === 'transfer' ? 'New transfer' : 'New transaction'}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`pill-btn ${mode === 'normal' ? 'active' : ''}`}
            onClick={() => switchMode('normal')}
          >
            Transaction
          </button>
          <button
            type="button"
            className={`pill-btn ${mode === 'transfer' ? 'active' : ''}`}
            onClick={() => switchMode('transfer')}
          >
            Transfer
          </button>
        </div>

        {mode === 'normal' ? (
          <div className="modal-form-grid">
            <label className="form-field">
              Date
              <input type="date" value={normalForm.date} onChange={(e) => setNormalField('date', e.target.value)} />
            </label>
            <label className="form-field">
              Account
              <select value={normalForm.account_id} onChange={(e) => setNormalField('account_id', e.target.value)}>
                {Object.entries(ACCOUNT_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Direction
              <select value={normalForm.direction} onChange={(e) => handleDirectionChange(e.target.value)}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
            </label>
            <label className="form-field">
              Category
              <select value={selectedCategory} onChange={(e) => setNormalField('category', e.target.value)}>
                {normalCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="link-btn" ref={manageLinkRef} onClick={openManager}>
                Manage categories
              </button>
            </label>
            <label className="form-field">
              Amount
              <input type="number" step="0.01" min="0.01" placeholder="0.00" value={normalForm.amount} onChange={(e) => setNormalField('amount', e.target.value)} />
            </label>
            <label className="form-field">
              Note
              <input type="text" placeholder="optional" value={normalForm.comment} onChange={(e) => setNormalField('comment', e.target.value)} />
            </label>
          </div>
        ) : (
          <div className="modal-form-grid">
            <fieldset className="transfer-direction-fieldset">
              <legend>Direction</legend>
              {TRANSFER_DIRECTIONS.map((d) => (
                <label key={d.value} className="transfer-direction-option">
                  <input
                    type="radio"
                    name="transfer-direction"
                    value={d.value}
                    checked={transferForm.directionKey === d.value}
                    onChange={() => handleTransferDirectionChange(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </fieldset>
            <label className="form-field">
              From
              <div className="modal-readonly">{ACCOUNT_NAMES[selectedTransferDirection.from]}</div>
            </label>
            <label className="form-field">
              To
              <div className="modal-readonly">{transferToName}</div>
            </label>
            <label className="form-field">
              Date
              <input type="date" value={transferForm.date} onChange={(e) => setTransferField('date', e.target.value)} />
            </label>
            <label className="form-field">
              Amount
              <input type="number" step="0.01" min="0.01" placeholder="0.00" value={transferForm.amount} onChange={(e) => setTransferField('amount', e.target.value)} />
            </label>
            <label className="form-field full">
              Note
              <input type="text" value={transferForm.comment} onChange={(e) => handleTransferCommentChange(e.target.value)} />
            </label>
          </div>
        )}

        {error && <span className="error-text" role="alert">{error}</span>}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={handleSubmit} disabled={submitting}>
            {mode === 'transfer' ? 'Add transfer' : 'Add transaction'}
          </button>
        </div>
      </div>

      {managerOpen && <CategoryManagerModal onClose={closeManager} />}
    </div>
  )
}
