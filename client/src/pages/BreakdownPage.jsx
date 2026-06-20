import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { currentMonthStr, monthLabel } from '../utils/dateUtils.js'
import { formatCurrency } from '../utils/format.js'
import { useCategories } from '../contexts/categories.js'
import DonutChart from '../components/breakdown/DonutChart.jsx'
import { buildDonutSegments } from '../utils/donutMath.js'
import CategoryBarList from '../components/breakdown/CategoryBarList.jsx'
import BreakdownControls from '../components/breakdown/BreakdownControls.jsx'

function decorate(rows, colorFor) {
  return rows.map((r) => ({ category: r.category, value: r.total, color: colorFor(r.category) }))
    .sort((a, b) => b.value - a.value)
}

export default function BreakdownPage() {
  const { colorFor } = useCategories()
  const [availableMonths, setAvailableMonths] = useState([])
  const [month, setMonth] = useState(currentMonthStr())
  const [summary, setSummary] = useState(null)
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
    api.getMonthlySummary(month).then((data) => {
      setSummary(data)
      setLoading(false)
    })
  }, [month])

  const outCats = useMemo(() => (summary ? decorate(summary.byCategoryOut, colorFor) : []), [summary, colorFor])
  const inCats = useMemo(() => (summary ? decorate(summary.byCategoryIn, colorFor) : []), [summary, colorFor])
  const outTotal = outCats.reduce((s, c) => s + c.value, 0)
  const inTotal = inCats.reduce((s, c) => s + c.value, 0)
  const outDonut = useMemo(() => buildDonutSegments(outCats, outTotal), [outCats, outTotal])
  const inDonut = useMemo(() => buildDonutSegments(inCats, inTotal), [inCats, inTotal])

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
        <div className="two-col-grid">
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="donut-card-head">
              <h2><span style={{ color: 'var(--red)' }}>↑</span> Money out</h2>
              <span className="donut-card-total">{formatCurrency(outTotal)}</span>
            </div>
            <div className="donut-layout">
              <DonutChart segments={outDonut} centerLabel="Spent" centerValue={formatCurrency(outTotal)} />
              <CategoryBarList categories={outCats} total={outTotal} mode={mode} />
            </div>
          </div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="donut-card-head">
              <h2><span style={{ color: 'var(--green)' }}>↓</span> Money in</h2>
              <span className="donut-card-total">{formatCurrency(inTotal)}</span>
            </div>
            <div className="donut-layout">
              <DonutChart segments={inDonut} centerLabel="Earned" centerValue={formatCurrency(inTotal)} />
              <CategoryBarList categories={inCats} total={inTotal} mode={mode} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
