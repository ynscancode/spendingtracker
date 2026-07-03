import { monthLabel } from '../../utils/dateUtils.js'
import DayGroup from './DayGroup.jsx'

export default function TransactionGroup({ year, monthsMap, editingId, onEdit, onSaveEdit, onCancelEdit, onDelete }) {
  const months = [...monthsMap.entries()].sort(([a], [b]) => b.localeCompare(a))

  return (
    <div className="year-group">
      <h2 className="page-eyebrow" style={{ fontSize: 'var(--font-lg)', textTransform: 'none', marginTop: 24 }}>{year}</h2>
      {months.map(([month, daysMap]) => {
        const days = [...daysMap.entries()].sort(([a], [b]) => b.localeCompare(a))
        return (
          <div key={month} className="month-group table-card" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Category</th>
                  <th className="col-amount">In</th>
                  <th className="col-amount">Out</th>
                  <th>Note</th>
                  <th className="col-amount">Balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr className="month-label-row"><td colSpan={7} style={{ padding: '4px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 'var(--font-sm)' }}>{monthLabel(month)}</td></tr>
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
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
