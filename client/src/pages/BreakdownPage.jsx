import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { currentMonthStr, monthLabel, monthRangeFor } from '../utils/dateUtils.js'
import { formatCurrency } from '../utils/format.js'
import { ACCOUNTS } from '../constants/categories.js'
import { useCategories } from '../contexts/categories.js'
import DonutChart from '../components/breakdown/DonutChart.jsx'
import { buildDonutSegments } from '../utils/donutMath.js'
import CategoryBarList from '../components/breakdown/CategoryBarList.jsx'
import BreakdownControls from '../components/breakdown/BreakdownControls.jsx'

// Derive a category breakdown for one account from the raw transaction
// list, excluding transfers (internal movement, not real income/spend).
function breakdownFor(transactions, accountId, direction, colorFor) {
  const totals = {}
  transactions.forEach((t) => {
    if (t.account_id !== accountId || t.is_transfer || t.direction !== direction) return
    totals[t.category] = (totals[t.category] || 0) + t.amount
  })
  return Object.entries(totals)
    .map(([category, value]) => ({ category, value, color: colorFor(category) }))
    .sort((a, b) => b.value - a.value)
}

function DonutCard({ icon, iconColor, label, centerLabel, cats, mode }) {
  const total = cats.reduce((s, c) => s + c.value, 0)
  const donut = buildDonutSegments(cats, total)
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="donut-card-head">
        <h2><span style={{ color: iconColor }}>{icon}</span> {label}</h2>
        <span className="donut-card-total">{formatCurrency(total)}</span>
      </div>
      <div className="donut-layout">
        <DonutChart segments={donut} centerLabel={centerLabel} centerValue={formatCurrency(total)} />
        <CategoryBarList categories={cats} total={total} mode={mode} />
      </div>
    </div>
  )
}

export default function BreakdownPage() {
  const { colorFor } = useCategories()
  const [availableMonths, setAvailableMonths] = useState([])
  const [month, setMonth] = useState(currentMonthStr())
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('both')

  useEffect(() => {
    // Pull the full transaction history once just to know which months have
    // data, so the month <select> can offer real history instead of only
    // the current month. No new backend endpoint needed for this.
    api.getTransactions({}).then((all) => {
      const months = [...new Set(all.map((t) => t.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a))
      setAvailableMonths(months.length ? months : [currentMonthStr()])
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    const { from, to } = monthRangeFor(month)
    api.getTransactions({ from, to }).then((data) => {
      setTransactions(data)
      setLoading(false)
    })
  }, [month])

  const spendOut = useMemo(() => breakdownFor(transactions, ACCOUNTS.SPENDING, 'out', colorFor), [transactions, colorFor])
  const spendIn = useMemo(() => breakdownFor(transactions, ACCOUNTS.SPENDING, 'in', colorFor), [transactions, colorFor])
  const saveOut = useMemo(() => breakdownFor(transactions, ACCOUNTS.SAVINGS, 'out', colorFor), [transactions, colorFor])
  const saveIn = useMemo(() => breakdownFor(transactions, ACCOUNTS.SAVINGS, 'in', colorFor), [transactions, colorFor])

  return (
    <div className="page-animate">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Breakdown</h1>
        </div>
        <div className="breakdown-header-controls">
          <label className="breakdown-select-label">
            <span className="filter-strip-label">Month</span>
            <select className="breakdown-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
          <BreakdownControls mode={mode} onModeChange={setMode} />
        </div>
      </div>

      {loading ? (
        <div className="loading-placeholder"><p>Loading...</p></div>
      ) : (
        <>
          <div className="page-eyebrow">Spending</div>
          <div className="two-col-grid">
            <DonutCard icon="↑" iconColor="var(--red)" label="Money out" centerLabel="Spent" cats={spendOut} mode={mode} />
            <DonutCard icon="↓" iconColor="var(--green)" label="Money in" centerLabel="Earned" cats={spendIn} mode={mode} />
          </div>

          <div className="page-eyebrow" style={{ marginTop: 30 }}>Savings</div>
          <div className="two-col-grid">
            <DonutCard icon="↑" iconColor="var(--red)" label="Money out" centerLabel="Spent" cats={saveOut} mode={mode} />
            <DonutCard icon="↓" iconColor="var(--green)" label="Money in" centerLabel="Earned" cats={saveIn} mode={mode} />
          </div>
        </>
      )}
    </div>
  )
}
