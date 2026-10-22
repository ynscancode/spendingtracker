import { dayLabel } from '../../utils/dateUtils.js'
import TransactionRow from './TransactionRow.jsx'
import { computeDayTotals } from './dayTotals.js'
import { formatInflow, formatOutflow } from '../../utils/format.js'
import BalanceValue from './BalanceValue.jsx'

// data-label feeds the phone-only "In / Out / Bal" prefixes (CSS ::before); the
// empty <td>s are spacer columns that the phone layout hides.
function TotalRow({ label, totalIn, totalOut, balance, indent }) {
  return (
    <tr className={`day-total-row${indent ? ' day-sub-row' : ''}`} role="row">
      <td colSpan={2} className={indent ? 'day-total-label' : ''} style={indent ? { paddingLeft: 24 } : undefined} role="cell">
        {label}
      </td>
      <td className="col-amount cell-in" data-label="In" role="cell">{formatInflow(totalIn)}</td>
      <td className="col-amount cell-out" data-label="Out" role="cell">{formatOutflow(totalOut)}</td>
      <td role="cell"></td>
      <td className="col-amount" data-label="Bal" role="cell"><BalanceValue value={balance} /></td>
      <td role="cell"></td>
    </tr>
  )
}

export default function DayGroup({ date, txns, editingId, onEdit, onSaveEdit, onCancelEdit, onDelete }) {
  const totals = computeDayTotals(txns)
  // Only show the per-account breakdown when the day actually spans more than
  // one account — otherwise it just repeats the combined total.
  const showPerAccount = totals.perAccount.length > 1
  const combinedBalance = showPerAccount
    ? totals.perAccount.reduce((sum, a) => sum + a.endOfDayBalance, 0)
    : totals.perAccount[0]?.endOfDayBalance ?? 0
  // Phone card header summary: the already-computed combined totals, shown
  // decoratively (the Day total row below is what assistive tech reads).
  const headerSum = `${totals.combined.in > 0 ? `+${formatInflow(totals.combined.in)} · ` : ''}${formatOutflow(totals.combined.out)}`

  // One <tbody> per day: a hard-bordered block on desktop (ARCH-0010) and the
  // per-day card on phones.
  return (
    <tbody className="tx-day" role="rowgroup">
      <tr className="day-header-row" role="row">
        <td colSpan={7} className="day-header-cell" role="cell" aria-colspan="7">
          <div className="day-header-row-inner">
            <span className="day-header-label">{dayLabel(date)}</span>
            <span className="day-header-sum" aria-hidden="true">{headerSum}</span>
          </div>
        </td>
      </tr>
      {txns.map((txn) => (
        <TransactionRow
          key={txn.id}
          txn={txn}
          isEditing={txn.id === editingId}
          onEdit={onEdit}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
          onDelete={onDelete}
        />
      ))}
      <TotalRow
        label={showPerAccount ? 'Day total (combined)' : 'Day total'}
        totalIn={totals.combined.in}
        totalOut={totals.combined.out}
        balance={combinedBalance}
      />
      {showPerAccount && totals.perAccount.map((a) => (
        <TotalRow
          key={a.accountId}
          label={a.name}
          totalIn={a.in}
          totalOut={a.out}
          balance={a.endOfDayBalance}
          indent
        />
      ))}
    </tbody>
  )
}
