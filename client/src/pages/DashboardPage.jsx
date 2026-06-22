import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { todayStr, currentMonthStr, monthRangeFor, monthLabel, dayLabel } from '../utils/dateUtils.js'
import { formatCurrency, formatSigned, formatOutflow } from '../utils/format.js'
import { computeDailyInsights } from '../utils/insights.js'
import { ACCOUNTS } from '../constants/categories.js'
import { useDailyBudget } from '../hooks/useDailyBudget.js'
import { useCategories } from '../contexts/categories.js'
import MonthSwitcher from '../components/layout/MonthSwitcher.jsx'
import TransactionModal from '../components/transactions/TransactionModal.jsx'
import DonutChart from '../components/breakdown/DonutChart.jsx'
import { buildDonutSegments } from '../utils/donutMath.js'
import CategoryBarList from '../components/breakdown/CategoryBarList.jsx'
import BreakdownControls from '../components/breakdown/BreakdownControls.jsx'
import { fillColorFor, suffixFor } from '../utils/budgetHealth.js'

function daysInMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

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

// Simple two-bar money-in vs money-out comparison for one account, scaled
// relative to whichever of the two totals is larger. Bars are vertical to
// sit naturally alongside the donut pair above. Always shows both labels
// and dollar values so the comparison isn't color-only.
function InOutCompareCard({ totalIn, totalOut }) {
  const max = Math.max(totalIn, totalOut)
  const heightFor = (value) => (max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4)
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: '0 0 18px', font: '600 16px/1 var(--font-ui)', letterSpacing: '-.01em' }}>In vs. out</h2>
      <div className="inout-compare">
        <div className="inout-compare-bar-col">
          <div className="inout-compare-track">
            <div
              className="inout-compare-fill"
              style={{ height: `${heightFor(totalOut)}%`, background: 'var(--red)' }}
            />
          </div>
          <div className="inout-compare-value" style={{ color: 'var(--red)' }}>{formatCurrency(totalOut)}</div>
          <div className="inout-compare-label">Money out</div>
        </div>
        <div className="inout-compare-bar-col">
          <div className="inout-compare-track">
            <div
              className="inout-compare-fill"
              style={{ height: `${heightFor(totalIn)}%`, background: 'var(--green)' }}
            />
          </div>
          <div className="inout-compare-value" style={{ color: 'var(--green)' }}>{formatCurrency(totalIn)}</div>
          <div className="inout-compare-label">Money in</div>
        </div>
      </div>
    </div>
  )
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

export default function DashboardPage() {
  const { outgoingFor, colorFor } = useCategories()
  const [accounts, setAccounts] = useState([])
  const [monthTransactions, setMonthTransactions] = useState([])
  const [breakdownTransactions, setBreakdownTransactions] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr())
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [breakdownMode, setBreakdownMode] = useState('both')
  const [dailyBudget, setDailyBudget] = useDailyBudget()
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')

  // Overview is Spending-only by design — there is no account selector on
  // this page. The Breakdown section at the bottom is the one exception:
  // it remains unscoped and always shows both accounts.
  const scopeAccountId = ACCOUNTS.SPENDING

  const month = currentMonthStr()
  const today = todayStr()

  async function loadAll() {
    setLoading(true)
    const { from, to } = monthRangeFor(month)
    const [accountsData, txns, budgetsRes] = await Promise.all([
      api.getAccounts(),
      api.getTransactions({ from, to }),
      api.getBudgets(month),
    ])
    setAccounts(accountsData)
    setMonthTransactions(txns)
    setBudgets(budgetsRes.budgets)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Decoupled from the current-month `loadAll` above — this drives only
  // Monthly insights and the Breakdown sections (see selectedMonth usage
  // below), so the user can browse other months there without affecting
  // anything else on the page (Daily insights, Budget card, Top spending,
  // Recent activity, balance cards all stay anchored to the real current
  // month via monthTransactions/month).
  useEffect(() => {
    async function loadBreakdown() {
      const { from, to } = monthRangeFor(selectedMonth)
      const txns = await api.getTransactions({ from, to })
      setBreakdownTransactions(txns)
    }
    loadBreakdown()
  }, [selectedMonth])

  async function handleCreateTransaction(data) {
    await api.createTransaction(data)
    await loadAll()
  }

  async function handleCreateTransfer(data) {
    await api.createTransfer(data)
    await loadAll()
  }

  function startEditingBudget() {
    setBudgetDraft(dailyBudget != null ? String(dailyBudget) : '')
    setEditingBudget(true)
  }

  function commitBudgetDraft() {
    const value = budgetDraft.trim()
    if (value === '') {
      // Empty input on commit reverts (no-op) rather than clearing — use
      // the explicit "No budget" action to clear.
      setEditingBudget(false)
      return
    }
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) {
      // Reject garbage/negatives: revert to prior value, no crash.
      setEditingBudget(false)
      return
    }
    setDailyBudget(amount)
    setEditingBudget(false)
  }

  function handleClearDailyBudget() {
    setDailyBudget(null)
    setEditingBudget(false)
  }

  if (loading) {
    return <div className="loading-placeholder"><p>Loading...</p></div>
  }

  const scopedAccount = accounts.find((a) => a.id === scopeAccountId)
  const spendingAccount = accounts.find((a) => a.id === ACCOUNTS.SPENDING)
  const savingsAccount = accounts.find((a) => a.id === ACCOUNTS.SAVINGS)
  const scopedBal = scopedAccount?.balance ?? 0
  const netWorth = (spendingAccount?.balance ?? 0) + (savingsAccount?.balance ?? 0)

  // Start-of-month balance = current balance minus this month's net delta
  // for that account (transactions already include transfers, which
  // correctly net to zero across the pair for net-worth purposes).
  function netDeltaForAccount(accountId) {
    return monthTransactions
      .filter((t) => t.account_id === accountId)
      .reduce((sum, t) => sum + (t.direction === 'in' ? t.amount : -t.amount), 0)
  }
  const scopedDelta = netDeltaForAccount(scopeAccountId)
  const netDelta = netDeltaForAccount(ACCOUNTS.SPENDING) + netDeltaForAccount(ACCOUNTS.SAVINGS)

  // Everything below is scoped to the selected account.
  const scopedTransactions = monthTransactions.filter((t) => t.account_id === scopeAccountId)
  // Breakdown-scoped equivalent, driving only Monthly insights + the
  // Breakdown sections (selectedMonth, not the page's current month).
  const scopedBreakdownTransactions = breakdownTransactions.filter((t) => t.account_id === scopeAccountId)

  // Monthly insights money in/out/net: real money movement only, excludes
  // transfers (distinct from the balance-delta figures above, which
  // intentionally include transfers). Scoped to selectedMonth, not the
  // page's current month.
  const sumIn = scopedBreakdownTransactions.filter((t) => t.direction === 'in' && !t.is_transfer).reduce((s, t) => s + t.amount, 0)
  const sumOut = scopedBreakdownTransactions.filter((t) => t.direction === 'out' && !t.is_transfer).reduce((s, t) => s + t.amount, 0)
  const net = sumIn - sumOut
  const savingsRate = sumIn > 0 ? Math.round((net / sumIn) * 100) : 0

  const insights = computeDailyInsights(scopedTransactions, { todayDate: today, dailyBudget })
  const hasDailyBudget = dailyBudget !== null

  const dailyInsightTiles = [
    {
      label: 'Spent today',
      value: formatCurrency(insights.spentToday),
      valueColor: insights.spentTodayOver ? 'var(--red)' : 'var(--text)',
      note: hasDailyBudget
        ? `${formatCurrency(insights.spentTodayNoteAmount)} ${insights.spentTodayNote}`
        : '—',
      noteColor: insights.spentTodayOver ? 'var(--red)' : (hasDailyBudget ? 'var(--green)' : 'var(--muted)'),
    },
    {
      label: 'Daily average',
      value: formatCurrency(insights.dailyAverage),
      valueColor: 'var(--text)',
      note: hasDailyBudget
        ? `${insights.dailyAveragePct}% ${insights.dailyAverageOver ? 'above target' : 'under target'}`
        : 'No daily budget set',
      noteColor: hasDailyBudget ? (insights.dailyAverageOver ? 'var(--red)' : 'var(--green)') : 'var(--muted)',
    },
    {
      label: 'Busiest day',
      value: formatCurrency(insights.busiestDayAmount),
      valueColor: 'var(--text)',
      note: insights.busiestDayLabel,
      noteColor: 'var(--muted)',
    },
    {
      label: 'Projected month',
      value: formatCurrency(insights.projectedMonth),
      valueColor: 'var(--text)',
      note: hasDailyBudget
        ? `${insights.daysOnBudget} of ${insights.daysConsidered} days on budget`
        : 'No daily budget set',
      noteColor: 'var(--muted)',
    },
  ]

  // Daily bar chart for the whole month — scoped to selectedMonth (Monthly
  // insights), not the page's current month.
  const breakdownRealOut = scopedBreakdownTransactions.filter((t) => t.direction === 'out' && !t.is_transfer)
  const dayMap = {}
  // Tracks each day's biggest single purchase (amount + category + color)
  // alongside the running total above. breakdownRealOut is already scoped
  // to scopeAccountId (Spending) via scopedBreakdownTransactions, so using
  // the transaction's own account_id here resolves to the same account —
  // just routed through colorFor for consistency with the rest of the file.
  const dayBiggestMap = {}
  breakdownRealOut.forEach((t) => {
    const d = Number(t.date.slice(8, 10))
    dayMap[d] = (dayMap[d] || 0) + t.amount
    const current = dayBiggestMap[d]
    if (!current || t.amount > current.amount) {
      dayBiggestMap[d] = { amount: t.amount, category: t.category, color: colorFor(t.account_id, t.category) }
    }
  })
  const totalDays = daysInMonth(selectedMonth)
  // When no daily budget is set, scale off actual max spend only — no
  // budget reference line to draw, and no "over" red-coloring since
  // there's nothing to exceed.
  const maxDay = hasDailyBudget
    ? Math.max(1, dailyBudget, ...Object.values(dayMap))
    : Math.max(1, ...Object.values(dayMap))
  const budgetPct = hasDailyBudget ? (dailyBudget / maxDay) * 100 : null
  const dailyBars = Array.from({ length: totalDays }, (_, i) => {
    const v = dayMap[i + 1] || 0
    const h = Math.max(2, Math.round((v / maxDay) * 100))
    const over = hasDailyBudget && v > dailyBudget
    const bg = v > 0 ? (over ? 'var(--red)' : 'var(--accent)') : 'var(--surface-2)'
    const opacity = v > 0 ? 0.55 + 0.45 * (v / maxDay) : 1
    return { height: h, bg, opacity, total: v, biggest: dayBiggestMap[i + 1] || null, day: i + 1 }
  })

  // Budget summary is Spending-only — budgeting doesn't apply to Savings.
  // The budgets array now always contains every Spending outgoing category
  // (0-defaulted where the user never set one), so summing it covers all
  // categories without any gap-filling.
  const spendingRealOut = monthTransactions.filter((t) => t.account_id === ACCOUNTS.SPENDING && t.direction === 'out' && !t.is_transfer)
  const catActualsMap = {}
  spendingRealOut.forEach((t) => { catActualsMap[t.category] = (catActualsMap[t.category] || 0) + t.amount })
  const budgetRows = budgets.map((b) => {
    const actual = catActualsMap[b.category] || 0
    const pct = b.amount > 0 ? Math.round((actual / b.amount) * 100) : (actual > 0 ? Infinity : 0)
    const health = b.amount === 0
      ? (actual > 0 ? 'over' : 'under')
      : (pct > 100 ? 'over' : pct >= 90 ? 'near' : 'under')
    return { category: b.category, budget: b.amount, actual, pct, health }
  })
  const totalBudgeted = budgetRows.reduce((s, r) => s + r.budget, 0)
  const totalSpentBudgeted = budgetRows.reduce((s, r) => s + r.actual, 0)
  const budgetUsedPct = totalBudgeted > 0 ? Math.round((totalSpentBudgeted / totalBudgeted) * 100) : 0
  // Full comparison, worst-first — this replaces the Budget page's old,
  // now-deleted "Budget vs. actual" card so there's exactly one place to
  // see budget vs. actual instead of two duplicated progress bars.
  const chartRows = [...budgetRows].sort((a, b) => {
    const pctA = a.budget > 0 ? a.actual / a.budget : (a.actual > 0 ? Infinity : 0)
    const pctB = b.budget > 0 ? b.actual / b.budget : (b.actual > 0 ? Infinity : 0)
    return pctB - pctA
  })

  // Top spending by category (this month, real spend only) — stays
  // anchored to the page's current month, independent of selectedMonth.
  const realOut = scopedTransactions.filter((t) => t.direction === 'out' && !t.is_transfer)
  const catTotalsMap = {}
  realOut.forEach((t) => { catTotalsMap[t.category] = (catTotalsMap[t.category] || 0) + t.amount })
  const topCats = Object.entries(catTotalsMap)
    .map(([category, value]) => ({ category, value, color: colorFor(scopeAccountId, category) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const maxCat = Math.max(1, ...topCats.map((c) => c.value))

  // Recent activity: last 6 transactions this month for the selected account.
  const recent = [...scopedTransactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 6)
    .map((t) => {
      const signed = t.direction === 'in' ? t.amount : -t.amount
      const isTransfer = !!t.is_transfer
      return {
        id: t.id,
        color: isTransfer ? 'var(--faint)' : colorFor(t.account_id, t.category),
        comment: isTransfer ? 'Transfer' : t.comment,
        category: isTransfer ? 'Transfer' : t.category,
        meta: dayLabel(t.date),
        amountText: formatSigned(signed),
        amountColor: signed >= 0 ? 'var(--green)' : 'var(--text)',
      }
    })

  // Breakdown section: always shows both accounts, unaffected by the
  // page being Spending-scoped elsewhere (same treatment as Net worth).
  // Scoped to selectedMonth via breakdownTransactions, not the page's
  // current month.
  const spendOut = breakdownFor(breakdownTransactions, ACCOUNTS.SPENDING, 'out', (cat) => colorFor(ACCOUNTS.SPENDING, cat))
  const spendIn = breakdownFor(breakdownTransactions, ACCOUNTS.SPENDING, 'in', (cat) => colorFor(ACCOUNTS.SPENDING, cat))
  const saveOut = breakdownFor(breakdownTransactions, ACCOUNTS.SAVINGS, 'out', (cat) => colorFor(ACCOUNTS.SAVINGS, cat))
  const saveIn = breakdownFor(breakdownTransactions, ACCOUNTS.SAVINGS, 'in', (cat) => colorFor(ACCOUNTS.SAVINGS, cat))
  const spendTotalOut = spendOut.reduce((s, c) => s + c.value, 0)
  const spendTotalIn = spendIn.reduce((s, c) => s + c.value, 0)
  const saveTotalOut = saveOut.reduce((s, c) => s + c.value, 0)
  const saveTotalIn = saveIn.reduce((s, c) => s + c.value, 0)

  return (
    <div className="page-animate">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn" onClick={() => setModalOpen(true)}>+ Add transaction</button>
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <h2>{dayLabel(today)}</h2>
          {editingBudget ? (
            <div className="daily-budget-editor">
              <label className="visually-hidden" htmlFor="daily-budget-input">Daily budget</label>
              <input
                id="daily-budget-input"
                type="number"
                step="0.01"
                min="0"
                autoFocus
                placeholder="0.00"
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
                onBlur={commitBudgetDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitBudgetDraft()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditingBudget(false)
                  }
                }}
              />
              {hasDailyBudget && (
                <button
                  type="button"
                  className="btn-sm btn-sm-delete"
                  onMouseDown={(e) => { e.preventDefault(); handleClearDailyBudget() }}
                  onClick={handleClearDailyBudget}
                >
                  No budget
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="pill-tag pill-tag-editable"
              onClick={startEditingBudget}
            >
              {hasDailyBudget ? `Budget ${formatCurrency(dailyBudget)}/day` : 'No daily budget'}
            </button>
          )}
        </div>
        <div className="card-grid tiles">
          {dailyInsightTiles.map((tile) => (
            <div className="stat-tile" key={tile.label}>
              <div className="stat-tile-label">{tile.label}</div>
              <div className="stat-tile-value" style={{ color: tile.valueColor }}>{tile.value}</div>
              <div className="stat-tile-note" style={{ color: tile.noteColor }}>{tile.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Budget</h2>
          {totalBudgeted > 0 && (
            <span
              className="pill-tag"
              style={totalSpentBudgeted > totalBudgeted ? { background: 'color-mix(in oklab, var(--red) 16%, transparent)', color: 'var(--red)' } : undefined}
            >
              {budgetUsedPct}% of budget used
            </span>
          )}
        </div>
        <div className="card-grid tiles">
          <div className="stat-tile">
            <div className="stat-tile-label">Total budgeted</div>
            <div className="stat-tile-value">{formatCurrency(totalBudgeted)}</div>
            <div className="stat-tile-note" style={{ color: 'var(--muted)' }}>
              Across {budgetRows.length} categories
            </div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Total spent</div>
            <div
              className="stat-tile-value"
              style={{ color: totalBudgeted > 0 && totalSpentBudgeted > totalBudgeted ? 'var(--red)' : 'var(--text)' }}
            >
              {formatCurrency(totalSpentBudgeted)}
            </div>
            <div className="stat-tile-note" style={{ color: totalBudgeted > 0 ? 'var(--muted)' : 'var(--faint)' }}>
              {totalBudgeted > 0 ? `${budgetUsedPct}% of budget` : 'No budget to compare'}
            </div>
          </div>
        </div>

        {outgoingFor(ACCOUNTS.SPENDING).length === 0 ? (
          <p className="empty-text" style={{ marginTop: 16 }}>
            No Spending categories to budget yet.
          </p>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="budget-legend">
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--green)' }} /> Under</span>
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--warning)' }} /> Near</span>
              <span className="budget-legend-item"><span className="cat-bar-row-swatch" style={{ background: 'var(--red)' }} /> Over</span>
            </div>
            {chartRows.map((row) => {
              const suffix = suffixFor(row.health)
              const displayPct = Number.isFinite(row.pct) ? row.pct : 100
              return (
                <div className="cat-bar-row" key={row.category}>
                  <div className="cat-bar-row-head">
                    <span className="cat-bar-row-label">
                      <span className="cat-bar-row-swatch" style={{ background: colorFor(ACCOUNTS.SPENDING, row.category) }} />
                      {row.category}
                    </span>
                    <span className="cat-bar-row-value" style={{ color: row.health === 'over' ? 'var(--red)' : 'var(--muted)' }}>
                      {formatCurrency(row.actual)} of {formatCurrency(row.budget)} ({displayPct}%)
                      {suffix && <span style={{ color: suffix.color }}>{suffix.text}</span>}
                    </span>
                  </div>
                  <div className="cat-bar-track">
                    <div
                      className="cat-bar-fill"
                      style={{ width: `${Math.min(100, displayPct)}%`, background: fillColorFor(row.health) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card-grid">
        <div className="balance-card">
          <div className="balance-card-label">
            <span className="balance-card-dot" style={{ background: 'var(--accent)' }} />
            Spending balance
          </div>
          <div className="balance-card-value">{formatCurrency(scopedBal)}</div>
          <div className={`balance-card-delta ${scopedDelta >= 0 ? 'delta-positive' : 'delta-negative'}`}>
            {formatSigned(scopedDelta)} this month
          </div>
        </div>
        <div className="balance-card accent">
          <div className="balance-card-label">Net worth</div>
          <div className="balance-card-value">{formatCurrency(netWorth)}</div>
          <div className={`balance-card-delta ${netDelta >= 0 ? 'delta-positive' : 'delta-negative'}`}>
            {formatSigned(netDelta)} this month
          </div>
        </div>
      </div>

      <div className="two-col-grid">
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ margin: '0 0 18px', font: '600 16px/1 var(--font-ui)', letterSpacing: '-.01em' }}>Top spending</h2>
          {topCats.length === 0 ? (
            <p className="empty-text">No spending yet this month.</p>
          ) : topCats.map((c) => (
            <div className="cat-bar-row" key={c.category}>
              <div className="cat-bar-row-head">
                <span className="cat-bar-row-label">
                  <span className="cat-bar-row-swatch" style={{ background: c.color }} />
                  {c.category}
                </span>
                <span className="cat-bar-row-value">{formatCurrency(c.value)}</span>
              </div>
              <div className="cat-bar-track">
                <div className="cat-bar-fill" style={{ width: `${Math.max(3, Math.round((c.value / maxCat) * 100))}%`, background: c.color }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ margin: '0 0 8px', font: '600 16px/1 var(--font-ui)', letterSpacing: '-.01em' }}>Recent activity</h2>
          {recent.length === 0 ? (
            <p className="empty-text">No transactions yet this month.</p>
          ) : recent.map((r) => (
            <div className="activity-row" key={r.id}>
              <span className="activity-dot" style={{ background: r.color }} />
              <div className="activity-main">
                <div className="activity-comment">{r.comment}</div>
                <div className="activity-meta">{r.meta}</div>
              </div>
              <div className="activity-amount" style={{ color: r.amountColor }}>{r.amountText}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-row" style={{ marginTop: 30, marginBottom: 12 }}>
        <h2 style={{ margin: 0, font: '600 16px/1 var(--font-ui)', letterSpacing: '-.01em' }}>Breakdown</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MonthSwitcher month={selectedMonth} onChange={setSelectedMonth} />
          <BreakdownControls mode={breakdownMode} onModeChange={setBreakdownMode} />
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Monthly insights</h2>
          <span className="pill-tag">Savings rate {savingsRate}%</span>
        </div>
        <div className="money-flow-grid">
          <div>
            <div className="money-flow-label">Money in</div>
            <div className="money-flow-value" style={{ color: 'var(--green)' }}>{formatCurrency(sumIn)}</div>
          </div>
          <div>
            <div className="money-flow-label">Money out</div>
            <div className="money-flow-value" style={{ color: 'var(--red)' }}>{formatCurrency(sumOut)}</div>
          </div>
          <div>
            <div className="money-flow-label">Net</div>
            <div className="money-flow-value" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatSigned(net)}</div>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <div className="daily-spending-header">
            <span className="money-flow-label">Daily spending</span>
            <span style={{ font: '500 10.5px/1 var(--font-num)', color: hasDailyBudget ? 'var(--accent)' : 'var(--muted)' }}>
              {hasDailyBudget ? `Budget ${formatCurrency(dailyBudget)}/day` : 'No daily budget'}
            </span>
          </div>
          <div className="bar-chart">
            {hasDailyBudget && (
              <div className="budget-line" style={{ bottom: `${Math.min(98, budgetPct)}%` }} />
            )}
            {dailyBars.map((bar, i) => (
              <div
                key={i}
                className="bar-chart-bar-wrap"
              >
                <div
                  className="bar-chart-bar"
                  style={{ height: `${bar.height}%`, background: bar.bg, opacity: bar.opacity }}
                />
                <div className="bar-chart-tooltip" role="tooltip">
                  <div className="bar-chart-tooltip-day">{monthLabel(selectedMonth).split(' ')[0]} {bar.day}</div>
                  <div className="bar-chart-tooltip-total">{formatOutflow(bar.total)} spent</div>
                  {bar.biggest ? (
                    <div className="bar-chart-tooltip-biggest">
                      <span className="bar-chart-tooltip-swatch" style={{ background: bar.biggest.color }} />
                      Biggest: {formatOutflow(bar.biggest.amount)} · {bar.biggest.category}
                    </div>
                  ) : (
                    <div className="bar-chart-tooltip-biggest bar-chart-tooltip-empty">No purchases</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="bar-chart-footer">
            <span>{monthLabel(selectedMonth).split(' ')[0]} 1</span>
            <span>{monthLabel(selectedMonth).split(' ')[0]} {totalDays}</span>
          </div>
        </div>
      </div>

      <div className="page-eyebrow">Spending</div>
      <div className="two-col-grid">
        <DonutCard icon="↑" iconColor="var(--red)" label="Money out" centerLabel="Spent" cats={spendOut} mode={breakdownMode} />
        <DonutCard icon="↓" iconColor="var(--green)" label="Money in" centerLabel="Earned" cats={spendIn} mode={breakdownMode} />
      </div>
      <div style={{ marginTop: 16 }}>
        <InOutCompareCard totalIn={spendTotalIn} totalOut={spendTotalOut} />
      </div>

      <div className="page-eyebrow" style={{ marginTop: 30 }}>Savings</div>
      <div className="two-col-grid">
        <DonutCard icon="↑" iconColor="var(--red)" label="Money out" centerLabel="Spent" cats={saveOut} mode={breakdownMode} />
        <DonutCard icon="↓" iconColor="var(--green)" label="Money in" centerLabel="Earned" cats={saveIn} mode={breakdownMode} />
      </div>
      <div style={{ marginTop: 16 }}>
        <InOutCompareCard totalIn={saveTotalIn} totalOut={saveTotalOut} />
      </div>

      {modalOpen && (
        <TransactionModal
          initialMode="normal"
          onClose={() => setModalOpen(false)}
          onCreateTransaction={handleCreateTransaction}
          onCreateTransfer={handleCreateTransfer}
        />
      )}
    </div>
  )
}
