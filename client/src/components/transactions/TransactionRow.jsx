import { useState } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { ACCOUNT_NAMES } from '../../constants/categories.js'
import { highlightClassFor, transferBadgeFor } from './highlight.js'
import { formatInflow, formatOutflow } from '../../utils/format.js'
import { useCategories } from '../../contexts/categories.js'
import { useCategoryColor } from '../../hooks/useCategoryColor.js'
import { useThresholds } from '../../contexts/thresholds.js'
import BalanceValue from './BalanceValue.jsx'
import AccountingValue from './AccountingValue.jsx'

// Table semantics are stated explicitly (role="row"/"cell") because the
// Transactions page restyles <table> parts with display:grid/block (and, on
// phones, turns each day into a card); some browsers drop the implicit table
// semantics once display is overridden. The markup stays one <table>.

function ReadRow({ txn, onEdit, onDelete }) {
  const colorFor = useCategoryColor()
  const { thresholds } = useThresholds()
  // Phone-only (<=760px) presentational state: whether the tap-to-reveal
  // Edit/Delete actions of this row are showing. On desktop the toggle button is
  // display:none and the actions are always visible, so this has no effect there.
  const [open, setOpen] = useState(false)
  const highlightClass = highlightClassFor(txn, thresholds)
  const isTransfer = !!txn.is_transfer
  // Transfers get one neutral hatched row background; orange/red spend warnings
  // (thresholds live in ThresholdsContext, editable via the legend on
  // TransactionsPage) render as a small dot next to the amount instead of a cell
  // background fill.
  const rowClass = isTransfer ? 'highlight-transfer xfer' : ''
  const isSpendWarning = highlightClass === 'highlight-orange' || highlightClass === 'highlight-red'
  const dotClass = isSpendWarning ? highlightClass : ''
  const badge = transferBadgeFor(txn)
  // Transfers resolve to var(--card) and are drawn as a dashed chip.
  const chipColor = colorFor(txn.account_id, txn.category, txn.direction)
  const warningTitle = highlightClass === 'highlight-red'
    ? `Large spend: over $${thresholds.red}`
    : highlightClass === 'highlight-orange'
      ? `Notable spend: over $${thresholds.orange}`
      : undefined
  const actionsId = `txn-actions-${txn.id}`
  const toggleLabel = `Show actions for ${txn.comment || txn.category}`

  return (
    <tr className={`txn-row txn-row-read ${rowClass}${open ? ' is-open' : ''}`} role="row">
      <td className="account-name-cell" role="cell">{ACCOUNT_NAMES[txn.account_id]}</td>
      <td className="cat-cell" role="cell">
        <span
          className={`tx-badge${isTransfer ? ' tx-badge--transfer' : ''}`}
          style={{ background: chipColor }}
          aria-hidden="true"
        >
          {isTransfer ? '⇄' : String(txn.category || '?').charAt(0).toUpperCase()}
        </span>
        <span
          className={`category-cell${isTransfer ? ' category-cell--transfer' : ''}`}
          style={{ background: chipColor }}
        >
          {txn.category}
        </span>
      </td>
      <td className={`col-amount ${txn.direction === 'in' ? 'cell-in' : 'cell-faint'}`} role="cell">
        {txn.direction === 'in' ? formatInflow(txn.amount) : '—'}
      </td>
      <td className={`col-amount ${txn.direction === 'out' ? 'cell-out' : 'cell-faint'}`} role="cell">
        {txn.direction === 'out' ? (
          <span className="amount-with-flag">
            <span className="spend-warning-dot-slot">
              {dotClass && (
                <span
                  className={`spend-warning-dot ${dotClass}`}
                  role="img"
                  aria-label={warningTitle}
                  title={warningTitle}
                />
              )}
            </span>
            <AccountingValue text={formatOutflow(txn.amount)} />
          </span>
        ) : '—'}
      </td>
      <td className="comment-cell" role="cell">
        {/* Phone only: whole-row tap target (display:none above 760px, so it is
            out of the tab order and the a11y tree on desktop). */}
        <button
          type="button"
          className="tx-row-toggle"
          aria-expanded={open}
          aria-controls={actionsId}
          aria-label={toggleLabel}
          onClick={() => setOpen((o) => !o)}
        />
        <span className="comment-text">{txn.comment}</span>
        {!txn.comment && <span className="comment-fallback" aria-hidden="true">{txn.category}</span>}
        {badge && (
          <span className={`transfer-label transfer-label--${txn.direction === 'in' ? 'in' : 'out'}`}>
            {badge.text}
          </span>
        )}
      </td>
      <td className="col-amount balance-cell" role="cell"><BalanceValue value={txn.running_balance} /></td>
      <td className="actions-cell" id={actionsId} role="cell">
        <button type="button" className="btn-sm" onClick={() => onEdit(txn.id)} aria-label="Edit transaction">
          <Pencil size={14} aria-hidden="true" />
          <span className="tx-btn-text" aria-hidden="true">Edit</span>
        </button>
        <button type="button" className="btn-sm btn-sm-delete" onClick={() => onDelete(txn)} aria-label="Delete transaction">
          <Trash2 size={14} aria-hidden="true" />
          <span className="tx-btn-text" aria-hidden="true">Delete</span>
        </button>
      </td>
    </tr>
  )
}

function EditRow({ txn, onSaveEdit, onCancelEdit }) {
  const { outgoingFor, incomingFor } = useCategories()
  const [date, setDate] = useState(txn.date)
  const [amount, setAmount] = useState(txn.amount)
  const [comment, setComment] = useState(txn.comment)
  const [category, setCategory] = useState(txn.category)
  const [error, setError] = useState(null)
  const isTransfer = !!txn.is_transfer

  const categoryOptions = isTransfer
    ? []
    : txn.direction === 'out'
      ? outgoingFor(txn.account_id)
      : incomingFor(txn.account_id)

  async function handleSave() {
    setError(null)
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Amount must be a positive number')
      return
    }
    const payload = { date, amount: amountNum, comment }
    if (!isTransfer) payload.category = category
    try {
      await onSaveEdit(txn.id, payload)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelEdit()
    }
  }

  return (
    <>
      <tr className="txn-row txn-row-editing" role="row">
        <td className="account-name-cell" role="cell">{ACCOUNT_NAMES[txn.account_id]}</td>
        <td className="cat-cell" data-label="Category" role="cell">
          {isTransfer ? (
            <span className="category-cell category-cell--transfer">{txn.category}</span>
          ) : (
            <select
              aria-label="Category"
              className="inline-edit-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={handleKeyDown}
            >
              {categoryOptions.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
        </td>
        <td className={`col-amount ${txn.direction === 'in' ? 'cell-in' : 'cell-faint'}`} data-label="Amount in" role="cell">
          {txn.direction === 'in' ? (
            <input
              type="number"
              min="0.01"
              step="0.01"
              aria-label="Amount in"
              className="inline-edit-input inline-edit-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          ) : '—'}
        </td>
        <td className={`col-amount ${txn.direction === 'out' ? 'cell-out' : 'cell-faint'}`} data-label="Amount out" role="cell">
          {txn.direction === 'out' ? (
            <input
              type="number"
              min="0.01"
              step="0.01"
              aria-label="Amount out"
              className="inline-edit-input inline-edit-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          ) : '—'}
        </td>
        <td className="comment-cell" data-label="Date and note" role="cell">
          <div className="inline-edit-comment-group">
            <input
              type="date"
              aria-label="Date"
              className="inline-edit-input inline-edit-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <input
              type="text"
              aria-label="Note"
              className="inline-edit-input inline-edit-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </td>
        <td className="col-amount balance-cell" role="cell"><BalanceValue value={txn.running_balance} /></td>
        <td className="actions-cell" role="cell">
          <button type="button" className="btn-sm btn-sm-save" onClick={handleSave} aria-label="Save transaction">
            <Check size={14} aria-hidden="true" />
            <span className="tx-btn-text" aria-hidden="true">Save</span>
          </button>
          <button type="button" className="btn-sm btn-sm-delete" onClick={onCancelEdit} aria-label="Cancel edit">
            <X size={14} aria-hidden="true" />
            <span className="tx-btn-text" aria-hidden="true">Cancel</span>
          </button>
        </td>
      </tr>
      {error && (
        <tr className="txn-row-error-row" role="row">
          <td colSpan={7} role="cell" aria-colspan="7">
            <span className="error-text" role="alert">{error}</span>
          </td>
        </tr>
      )}
    </>
  )
}

export default function TransactionRow({ txn, isEditing, onEdit, onSaveEdit, onCancelEdit, onDelete }) {
  if (isEditing) {
    return <EditRow txn={txn} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />
  }
  return <ReadRow txn={txn} onEdit={onEdit} onDelete={onDelete} />
}
