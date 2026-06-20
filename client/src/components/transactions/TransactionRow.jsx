import { Pencil, Trash2 } from 'lucide-react'
import { ACCOUNT_NAMES } from '../../constants/categories.js'
import { highlightClassFor, transferBadgeFor } from './highlight.js'
import { formatCurrency } from '../../utils/format.js'
import { useCategories } from '../../contexts/categories.js'

export default function TransactionRow({ txn, onEdit, onDelete }) {
  const { colorFor } = useCategories()
  const highlightClass = highlightClassFor(txn)
  const isTransfer = !!txn.is_transfer
  // Transfers get one neutral row background; >$20/>$40 spend warnings render as a
  // small dot next to the amount instead of a cell background fill.
  const rowClass = isTransfer ? 'highlight-transfer' : ''
  const isSpendWarning = highlightClass === 'highlight-orange' || highlightClass === 'highlight-red'
  const dotClass = isSpendWarning ? highlightClass : ''
  const amountText = `$${txn.amount.toFixed(2)}`
  const badge = transferBadgeFor(txn)
  const dotColor = isTransfer ? 'var(--faint)' : colorFor(txn.category)
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
        {txn.direction === 'in' ? amountText : '—'}
      </td>
      <td className={`col-amount ${txn.direction === 'out' ? 'cell-out' : 'cell-faint'}`}>
        {txn.direction === 'out' ? (
          <span className="amount-with-flag">
            {amountText}
            {dotClass && (
              <span
                className={`spend-warning-dot ${dotClass}`}
                role="img"
                aria-label={warningTitle}
                title={warningTitle}
              />
            )}
          </span>
        ) : '—'}
      </td>
      <td className="comment-cell">
        {txn.comment}
        {badge && <span className="transfer-label" style={{ color: badge.color }}>{badge.text}</span>}
      </td>
      <td className="col-amount balance-cell">{formatCurrency(txn.running_balance)}</td>
      <td className="actions-cell">
        <button type="button" className="btn-sm" onClick={() => onEdit(txn)} aria-label="Edit transaction">
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button type="button" className="btn-sm btn-sm-delete" onClick={() => onDelete(txn)} aria-label="Delete transaction">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}
