import { groupByYearMonthDay } from '../../utils/dateUtils.js'
import TransactionGroup from './TransactionGroup.jsx'

const desc = ([a], [b]) => b.localeCompare(a)

// Groups the FULL list (balances need every row), then marks which rows of each
// day are shown. `isVisible` is the category filter; the row being edited is
// exempt from it. Days/months/years with nothing shown are dropped.
export default function TransactionList({
  transactions, editingId, isVisible, onShowAll,
  onEdit, onSaveEdit, onCancelEdit, onDelete,
}) {
  if (transactions.length === 0) {
    return <p className="empty-text">No transactions in this range.</p>
  }

  const show = (txn) => txn.id === editingId || isVisible(txn)
  const years = []
  let shownCount = 0
  for (const [year, monthsMap] of [...groupByYearMonthDay(transactions).entries()].sort(desc)) {
    const months = []
    for (const [month, daysMap] of [...monthsMap.entries()].sort(desc)) {
      const days = []
      for (const [day, all] of [...daysMap.entries()].sort(desc)) {
        const visible = all.filter(show)
        if (visible.length === 0) continue
        shownCount += visible.length
        days.push([day, { all, visible }])
      }
      if (days.length > 0) months.push([month, days])
    }
    if (months.length > 0) years.push([year, months])
  }

  if (shownCount === 0) {
    return (
      <div className="tx-filter-empty" role="status">
        <p className="empty-text">
          No transactions match your category filter. {transactions.length} hidden in this range.
        </p>
        <button type="button" className="btn-secondary" onClick={onShowAll}>Show all categories</button>
      </div>
    )
  }

  return (
    <div>
      {years.map(([year, months]) => (
        <TransactionGroup
          key={year}
          year={year}
          months={months}
          editingId={editingId}
          onEdit={onEdit}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
