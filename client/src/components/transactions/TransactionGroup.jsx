import { monthLabel } from '../../utils/dateUtils.js'
import DayGroup from './DayGroup.jsx'

// One <table> per month. Roles are explicit because index.css restyles the
// table parts with display:grid/block (rows become grid rows; on phones each
// day <tbody> becomes a card), which can drop implicit table semantics. On
// phones the header row is visually hidden but stays in the a11y tree so the
// cells keep their column headers.
export default function TransactionGroup({ year, monthsMap, editingId, onEdit, onSaveEdit, onCancelEdit, onDelete }) {
  const months = [...monthsMap.entries()].sort(([a], [b]) => b.localeCompare(a))

  return (
    <div className="year-group">
      <h2 className="tx-year">{year}</h2>
      {months.map(([month, daysMap]) => {
        const days = [...daysMap.entries()].sort(([a], [b]) => b.localeCompare(a))
        return (
          <div key={month} className="month-group table-card tx-card">
            <table role="table" aria-label={`Transactions, ${monthLabel(month)}`}>
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Account</th>
                  <th role="columnheader" scope="col">Category</th>
                  <th role="columnheader" scope="col" className="col-amount">In</th>
                  <th role="columnheader" scope="col" className="col-amount">Out</th>
                  <th role="columnheader" scope="col">Note</th>
                  <th role="columnheader" scope="col" className="col-amount">Balance</th>
                  <th role="columnheader" scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody className="tx-month" role="rowgroup">
                <tr className="month-label-row" role="row">
                  <td colSpan={7} role="cell" aria-colspan="7">{monthLabel(month)}</td>
                </tr>
              </tbody>
              {days.map(([day, txns]) => (
                <DayGroup
                  key={day}
                  date={day}
                  txns={txns}
                  editingId={editingId}
                  onEdit={onEdit}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onDelete={onDelete}
                />
              ))}
            </table>
          </div>
        )
      })}
    </div>
  )
}
