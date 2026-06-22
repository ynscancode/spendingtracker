import { useState } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { ACCOUNT_NAMES } from '../../constants/categories.js'
import { highlightClassFor, transferBadgeFor } from './highlight.js'
import { formatInflow, formatOutflow } from '../../utils/format.js'
import { useCategories } from '../../contexts/categories.js'
import BalanceValue from './BalanceValue.jsx'
import AccountingValue from './AccountingValue.jsx'

function ReadRow({ txn, onEdit, onDelete }) {
  const { colorFor } = useCategories()
  const highlightClass = highlightClassFor(txn)
  const isTransfer = !!txn.is_transfer
  // Transfers get one neutral row background; >$20/>$40 spend warnings render as a
  // small dot next to the amount instead of a cell background fill.
  const rowClass = isTransfer ? 'highlight-transfer' : ''
  const isSpendWarning = highlightClass === 'highlight-orange' || highlightClass === 'highlight-red'
  const dotClass = isSpendWarning ? highlightClass : ''
  const badge = transferBadgeFor(txn)
  const dotColor = isTransfer ? 'var(--faint)' : colorFor(txn.account_id, txn.category)
  const warningTitle = highlightClass === 'highlight-red'
    ? 'Large spend: over $40'
    : highlightClass === 'highlight-orange'
      ? 'Notable spend: over $20'
      : undefined

  return (
    <tr className={`txn-row ${rowClass}`}>
      <td className="account-name-cell">{ACCOUNT_NAMES[txn.account_id]}</td>
      <td>
        <span className="category-cell">
          <span className="category-dot" style={{ background: dotColor }} />
          {txn.category}
        </span>
      </td>
      <td className={`col-amount ${txn.direction === 'in' ? 'cell-in' : 'cell-faint'}`}>
        {txn.direction === 'in' ? formatInflow(txn.amount) : '—'}
      </td>
      <td className={`col-amount ${txn.direction === 'out' ? 'cell-out' : 'cell-faint'}`}>
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
      <td className="comment-cell">
        {txn.comment}
        {badge && <span className="transfer-label" style={{ color: badge.color }}>{badge.text}</span>}
      </td>
      <td className="col-amount balance-cell"><BalanceValue value={txn.running_balance} /></td>
      <td className="actions-cell">
        <button type="button" className="btn-sm" onClick={() => onEdit(txn.id)} aria-label="Edit transaction">
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button type="button" className="btn-sm btn-sm-delete" onClick={() => onDelete(txn)} aria-label="Delete transaction">
          <Trash2 size={14} aria-hidden="true" />
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
      <tr className="txn-row txn-row-editing">
        <td className="account-name-cell">{ACCOUNT_NAMES[txn.account_id]}</td>
        <td>
          {isTransfer ? (
            <span className="category-cell">{txn.category}</span>
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
        <td className={`col-amount ${txn.direction === 'in' ? 'cell-in' : 'cell-faint'}`}>
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
        <td className={`col-amount ${txn.direction === 'out' ? 'cell-out' : 'cell-faint'}`}>
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
        <td className="comment-cell">
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
        <td className="col-amount balance-cell"><BalanceValue value={txn.running_balance} /></td>
        <td className="actions-cell">
          <button type="button" className="btn-sm" onClick={handleSave} aria-label="Save transaction">
            <Check size={14} aria-hidden="true" />
          </button>
          <button type="button" className="btn-sm btn-sm-delete" onClick={onCancelEdit} aria-label="Cancel edit">
            <X size={14} aria-hidden="true" />
          </button>
        </td>
      </tr>
      {error && (
        <tr className="txn-row-error-row">
          <td colSpan={7}>
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
