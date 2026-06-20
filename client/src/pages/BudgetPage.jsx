import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { currentMonthStr, monthLabel } from '../utils/dateUtils.js'
import { formatCurrency } from '../utils/format.js'
import { useCategories } from '../contexts/categories.js'
import MonthSwitcher from '../components/layout/MonthSwitcher.jsx'

// Budget health classification shared by the editing list and the chart.
// unset budgets are excluded from over/near math entirely (no health at all).
function healthFor(actual, budget) {
  if (budget == null) return 'unset'
  if (budget === 0) return actual > 0 ? 'over' : 'under'
  const pct = (actual / budget) * 100
  if (pct > 100) return 'over'
  if (pct >= 90) return 'near'
  return 'under'
}

function fillColorFor(health) {
  if (health === 'over') return 'var(--red)'
  if (health === 'near') return 'var(--warning)'
  if (health === 'under') return 'var(--green)'
  return 'var(--accent)' // unset
}

function suffixFor(health) {
  if (health === 'over') return { text: ' — over', color: 'var(--red)' }
  if (health === 'near') return { text: ' — near limit', color: 'var(--warning-text)' }
  return null
}

export default function BudgetPage() {
  const { outgoing, colorFor } = useCategories()
  const [month, setMonth] = useState(currentMonthStr())
  const [summary, setSummary] = useState(null)
  const [budgetsByCategory, setBudgetsByCategory] = useState({})
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [savingCategory, setSavingCategory] = useState(null)
  const [rowErrors, setRowErrors] = useState({})

  async function loadAll(forMonth) {
    setLoading(true)
    const [monthly, budgetsRes] = await Promise.all([
      api.getMonthlySummary(forMonth),
      api.getBudgets(forMonth),
    ])
    setSummary(monthly)
    const map = {}
    budgetsRes.budgets.forEach((b) => { map[b.category] = b.amount })
    setBudgetsByCategory(map)
    setDrafts({})
    setRowErrors({})
    setLoading(false)
  }

  useEffect(() => {
    loadAll(month)
  }, [month])

  if (loading || !summary) {
    return <div className="loading-placeholder"><p>Loading...</p></div>
  }

  const actualsMap = {}
  summary.byCategoryOut.forEach((r) => { actualsMap[r.category] = r.total })

  const rows = outgoing.map(({ name: category }) => {
    const actual = actualsMap[category] || 0
    const budget = Object.prototype.hasOwnProperty.call(budgetsByCategory, category)
      ? budgetsByCategory[category]
      : null
    return { category, actual, budget, health: healthFor(actual, budget), color: colorFor(category) }
  })

  const maxActual = Math.max(1, ...rows.map((r) => r.actual))

  async function commitBudget(category, rawValue) {
    const value = rawValue.trim()
    if (value === '') return
    const amount = Number(value)
    if (Number.isNaN(amount) || amount < 0) {
      setRowErrors((prev) => ({ ...prev, [category]: 'Enter an amount of 0 or more.' }))
      return
    }
    setSavingCategory(category)
    setRowErrors((prev) => ({ ...prev, [category]: null }))
    try {
      await api.setBudget({ month, category, amount })
      setBudgetsByCategory((prev) => ({ ...prev, [category]: amount }))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[category]
        return next
      })
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [category]: err.message }))
    } finally {
      setSavingCategory(null)
    }
  }

  async function handleClear(category) {
    setSavingCategory(category)
    setRowErrors((prev) => ({ ...prev, [category]: null }))
    try {
      await api.clearBudget({ month, category })
      setBudgetsByCategory((prev) => {
        const next = { ...prev }
        delete next[category]
        return next
      })
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[category]
        return next
      })
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [category]: err.message }))
    } finally {
      setSavingCategory(null)
    }
  }

  const chartRows = rows
    .filter((r) => r.budget != null)
    .sort((a, b) => {
      const pctA = a.budget > 0 ? a.actual / a.budget : (a.actual > 0 ? Infinity : 0)
      const pctB = b.budget > 0 ? b.actual / b.budget : (b.actual > 0 ? Infinity : 0)
      return pctB - pctA
    })
  const overCount = chartRows.filter((r) => r.health === 'over').length

  return (
    <div className="page-animate">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Budget</h1>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} />
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Category budgets</h2>
        </div>
        {rows.map((row) => {
          const draftValue = drafts[row.category]
          const inputValue = draftValue !== undefined ? draftValue : (row.budget != null ? String(row.budget) : '')
          const suffix = suffixFor(row.health)
          const isSaving = savingCategory === row.category
          const rowError = rowErrors[row.category]
          const inputId = `budget-input-${row.category}`

          const headValueText = row.budget != null
            ? `${formatCurrency(row.actual)} of ${formatCurrency(row.budget)}`
            : `${formatCurrency(row.actual)} spent`

          return (
            <div className="budget-row" key={row.category}>
              <div className="budget-row-head">
                <span className="cat-bar-row-label">
                  <span className="cat-bar-row-swatch" style={{ background: row.color }} />
                  {row.category}
                </span>
                <span
                  className="cat-bar-row-value"
                  style={{ color: row.health === 'over' ? 'var(--red)' : 'var(--muted)' }}
                >
                  {headValueText}
                  {suffix && <span style={{ color: suffix.color }}>{suffix.text}</span>}
                </span>
              </div>

              <div className="budget-row-bars">
                {row.budget != null ? (
                  <>
                    <div className="cat-bar-track thin">
                      <div className="cat-bar-fill" style={{ width: '100%', background: 'var(--border-strong)' }} />
                    </div>
                    <div className="cat-bar-track">
                      <div
                        className="cat-bar-fill"
                        style={{
                          width: `${row.budget > 0 ? Math.min(100, Math.round((row.actual / row.budget) * 100)) : (row.actual > 0 ? 100 : 0)}%`,
                          background: fillColorFor(row.health),
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="cat-bar-track">
                      <div
                        className="cat-bar-fill"
                        style={{ width: `${Math.max(3, Math.round((row.actual / maxActual) * 100))}%`, background: 'var(--accent)' }}
                      />
                    </div>
                    <span className="cell-faint budget-no-budget-tag">No budget set</span>
                  </>
                )}
              </div>

              <div className="budget-row-input">
                <label className="visually-hidden" htmlFor={inputId}>Budget for {row.category}</label>
                <input
                  id={inputId}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={inputValue}
                  disabled={isSaving}
                  style={{ opacity: isSaving ? 0.6 : 1 }}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [row.category]: e.target.value }))}
                  onBlur={(e) => commitBudget(row.category, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitBudget(row.category, e.target.value)
                    }
                  }}
                />
                {row.budget != null && (
                  <button
                    type="button"
                    className="btn-sm btn-sm-delete"
                    aria-label={`Clear budget for ${row.category}`}
                    disabled={isSaving}
                    onClick={() => handleClear(row.category)}
                  >
                    Clear
                  </button>
                )}
              </div>
              {rowError && <span className="error-text" role="alert">{rowError}</span>}
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Budget vs. actual</h2>
          {overCount > 0 && <span className="pill-tag">{overCount} over budget</span>}
        </div>

        {chartRows.length === 0 ? (
          <p className="empty-text">No budgets set for {monthLabel(month)}. Set a budget above to see it here.</p>
        ) : (
          <>
            <div className="budget-legend">
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--green)' }} /> Under</span>
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--warning)' }} /> Near</span>
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--red)' }} /> Over</span>
            </div>
            {chartRows.map((row) => {
              const suffix = suffixFor(row.health)
              const pct = row.budget > 0 ? Math.round((row.actual / row.budget) * 100) : (row.actual > 0 ? 100 : 0)
              return (
                <div className="cat-bar-row" key={row.category}>
                  <div className="cat-bar-row-head">
                    <span className="cat-bar-row-label">
                      <span className="cat-bar-row-swatch" style={{ background: row.color }} />
                      {row.category}
                    </span>
                    <span className="cat-bar-row-value" style={{ color: row.health === 'over' ? 'var(--red)' : 'var(--muted)' }}>
                      {formatCurrency(row.actual)} of {formatCurrency(row.budget)} ({pct}%)
                      {suffix && <span style={{ color: suffix.color }}>{suffix.text}</span>}
                    </span>
                  </div>
                  <div className="cat-bar-track thin">
                    <div className="cat-bar-fill" style={{ width: '100%', background: 'var(--border-strong)' }} />
                  </div>
                  <div className="cat-bar-track">
                    <div
                      className="cat-bar-fill"
                      style={{
                        width: `${row.budget > 0 ? Math.min(100, Math.round((row.actual / row.budget) * 100)) : (row.actual > 0 ? 100 : 0)}%`,
                        background: fillColorFor(row.health),
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
