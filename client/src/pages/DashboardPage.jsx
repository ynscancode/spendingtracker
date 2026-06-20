import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { todayStr, currentMonthStr, monthRangeFor, monthLabel, dayLabel } from '../utils/dateUtils.js'
import { formatCurrency, formatSigned } from '../utils/format.js'
import { computeDailyInsights } from '../utils/insights.js'
import { ACCOUNTS } from '../constants/categories.js'
import { DAILY_BUDGET } from '../constants/budget.js'
import { useCategories } from '../contexts/categories.js'
import TransactionModal from '../components/transactions/TransactionModal.jsx'

function daysInMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

export default function DashboardPage() {
  const { outgoing, colorFor } = useCategories()
  const [accounts, setAccounts] = useState([])
  const [monthlySummary, setMonthlySummary] = useState(null)
  const [monthTransactions, setMonthTransactions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const month = currentMonthStr()
  const today = todayStr()

  async function loadAll() {
    setLoading(true)
    const { from, to } = monthRangeFor(month)
    const [accountsData, monthly, txns, budgetsRes] = await Promise.all([
      api.getAccounts(),
      api.getMonthlySummary(month),
      api.getTransactions({ from, to }),
      api.getBudgets(month),
    ])
    setAccounts(accountsData)
    setMonthlySummary(monthly)
    setMonthTransactions(txns)
    setBudgets(budgetsRes.budgets)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreateTransaction(data) {
    await api.createTransaction(data)
    await loadAll()
  }

  async function handleCreateTransfer(data) {
    await api.createTransfer(data)
    await loadAll()
  }

  if (loading || !monthlySummary) {
    return <div className="loading-placeholder"><p>Loading...</p></div>
  }

  const spendingAccount = accounts.find((a) => a.id === ACCOUNTS.SPENDING)
  const savingsAccount = accounts.find((a) => a.id === ACCOUNTS.SAVINGS)
  const spendBal = spendingAccount?.balance ?? 0
  const saveBal = savingsAccount?.balance ?? 0
  const netWorth = spendBal + saveBal

  // Start-of-month balance = current balance minus this month's net delta
  // for that account (transactions already include transfers, which
  // correctly net to zero across the pair for net-worth purposes).
  function netDeltaForAccount(accountId) {
    return monthTransactions
      .filter((t) => t.account_id === accountId)
      .reduce((sum, t) => sum + (t.direction === 'in' ? t.amount : -t.amount), 0)
  }
  const spendDelta = netDeltaForAccount(ACCOUNTS.SPENDING)
  const saveDelta = netDeltaForAccount(ACCOUNTS.SAVINGS)

  const sumIn = monthlySummary.totalIn
  const sumOut = monthlySummary.totalOut
  const net = sumIn - sumOut
  const savingsRate = sumIn > 0 ? Math.round((net / sumIn) * 100) : 0

  const insights = computeDailyInsights(monthTransactions, { todayDate: today, dailyBudget: DAILY_BUDGET })

  const dailyInsightTiles = [
    {
      label: 'Spent today',
      value: formatCurrency(insights.spentToday),
      valueColor: insights.spentTodayOver ? 'var(--red)' : 'var(--text)',
      note: `${formatCurrency(insights.spentTodayNoteAmount)} ${insights.spentTodayNote}`,
      noteColor: insights.spentTodayOver ? 'var(--red)' : 'var(--green)',
    },
    {
      label: 'Daily average',
      value: formatCurrency(insights.dailyAverage),
      valueColor: 'var(--text)',
      note: `${insights.dailyAveragePct}% ${insights.dailyAverageOver ? 'above target' : 'under target'}`,
      noteColor: insights.dailyAverageOver ? 'var(--red)' : 'var(--green)',
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
      note: `${insights.daysOnBudget} of ${insights.daysConsidered} days on budget`,
      noteColor: 'var(--muted)',
    },
  ]

  // Daily bar chart for the whole month.
  const realOut = monthTransactions.filter((t) => t.direction === 'out' && !t.is_transfer)
  const dayMap = {}
  realOut.forEach((t) => {
    const d = Number(t.date.slice(8, 10))
    dayMap[d] = (dayMap[d] || 0) + t.amount
  })
  const totalDays = daysInMonth(month)
  const maxDay = Math.max(1, DAILY_BUDGET, ...Object.values(dayMap))
  const budgetPct = (DAILY_BUDGET / maxDay) * 100
  const dailyBars = Array.from({ length: totalDays }, (_, i) => {
    const v = dayMap[i + 1] || 0
    const h = Math.max(2, Math.round((v / maxDay) * 100))
    const over = v > DAILY_BUDGET
    const bg = v > 0 ? (over ? 'var(--red)' : 'var(--accent)') : 'var(--surface-2)'
    const opacity = v > 0 ? 0.55 + 0.45 * (v / maxDay) : 1
    return { height: h, bg, opacity }
  })

  // Budget summary: only SET budgets count toward totals/percent (unset
  // categories are excluded from both budgeted and spent sides per spec).
  const catActualsMap = {}
  realOut.forEach((t) => { catActualsMap[t.category] = (catActualsMap[t.category] || 0) + t.amount })
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
  const qualifying = budgetRows.filter((r) => r.health === 'over' || r.health === 'near')
  const overRows = qualifying.filter((r) => r.health === 'over').sort((a, b) => b.pct - a.pct)
  const nearRows = qualifying.filter((r) => r.health === 'near').sort((a, b) => b.pct - a.pct)
  const sortedQualifying = [...overRows, ...nearRows]
  const topQualifying = sortedQualifying.slice(0, 3)
  const extraQualifyingCount = sortedQualifying.length - topQualifying.length

  // Top spending by category (this month, real spend only).
  const catTotalsMap = {}
  realOut.forEach((t) => { catTotalsMap[t.category] = (catTotalsMap[t.category] || 0) + t.amount })
  const topCats = Object.entries(catTotalsMap)
    .map(([category, value]) => ({ category, value, color: colorFor(category) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const maxCat = Math.max(1, ...topCats.map((c) => c.value))

  // Recent activity: last 6 transactions this month.
  const recent = [...monthTransactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 6)
    .map((t) => {
      const signed = t.direction === 'in' ? t.amount : -t.amount
      const isTransfer = !!t.is_transfer
      return {
        id: t.id,
        color: isTransfer ? 'var(--faint)' : colorFor(t.category),
        comment: isTransfer ? 'Transfer' : t.comment,
        meta: `${t.account_id === ACCOUNTS.SAVINGS ? 'Savings' : 'Spending'} · ${dayLabel(t.date)}`,
        amountText: formatSigned(signed),
        amountColor: signed >= 0 ? 'var(--green)' : 'var(--text)',
      }
    })

  return (
    <div className="page-animate">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Overview</h1>
        </div>
        <button type="button" className="btn" onClick={() => setModalOpen(true)}>+ Add transaction</button>
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Daily insights</h2>
          <span className="pill-tag">Budget {formatCurrency(DAILY_BUDGET)}/day</span>
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
              {budgetRows.length} of {outgoing.length} categories set
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
              {totalBudgeted > 0 ? `${budgetUsedPct}% of budget` : 'No budgets set yet'}
            </div>
          </div>
        </div>

        {budgetRows.length === 0 ? (
          <p className="empty-text" style={{ marginTop: 16 }}>
            No budgets set for {monthLabel(month)}. Go to the Budget tab to set one.
          </p>
        ) : sortedQualifying.length === 0 ? (
          <div className="activity-row" style={{ marginTop: 4 }}>
            <span className="activity-dot" style={{ background: 'var(--green)' }} />
            <div className="activity-main">
              <div className="activity-comment">All budgeted categories are on track.</div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            {topQualifying.map((r) => {
              const suffix = r.health === 'over' ? ' — over' : ' — near limit'
              const suffixColor = r.health === 'over' ? 'var(--red)' : 'var(--warning-text)'
              return (
                <div className="activity-row" key={r.category}>
                  <span className="activity-dot" style={{ background: colorFor(r.category) }} />
                  <div className="activity-main">
                    <div className="activity-comment">{r.category}</div>
                    <div className="activity-meta">
                      {r.pct}% of {formatCurrency(r.budget)} budget
                      <span style={{ color: suffixColor }}>{suffix}</span>
                    </div>
                  </div>
                  <div className="activity-amount" style={{ color: r.health === 'over' ? 'var(--red)' : 'var(--warning-text)' }}>
                    {formatCurrency(r.actual)}
                  </div>
                </div>
              )
            })}
            {extraQualifyingCount > 0 && (
              <div className="activity-meta" style={{ marginTop: 8 }}>
                +{extraQualifyingCount} more over or near budget — see Budget tab
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card-grid">
        <div className="balance-card">
          <div className="balance-card-label">
            <span className="balance-card-dot" style={{ background: 'var(--accent)' }} />
            Spending
          </div>
          <div className="balance-card-value">{formatCurrency(spendBal)}</div>
          <div className={`balance-card-delta ${spendDelta >= 0 ? 'delta-positive' : 'delta-negative'}`}>
            {formatSigned(spendDelta)} this month
          </div>
        </div>
        <div className="balance-card">
          <div className="balance-card-label">
            <span className="balance-card-dot" style={{ background: 'var(--topup)' }} />
            Savings
          </div>
          <div className="balance-card-value">{formatCurrency(saveBal)}</div>
          <div className={`balance-card-delta ${saveDelta >= 0 ? 'delta-positive' : 'delta-negative'}`}>
            {formatSigned(saveDelta)} this month
          </div>
        </div>
        <div className="balance-card accent">
          <div className="balance-card-label">Net worth</div>
          <div className="balance-card-value">{formatCurrency(netWorth)}</div>
          <div className={`balance-card-delta ${net >= 0 ? 'delta-positive' : 'delta-negative'}`}>
            {formatSigned(net)} this month
          </div>
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
            <span style={{ font: '500 10.5px/1 var(--font-num)', color: 'var(--accent)' }}>
              Budget {formatCurrency(DAILY_BUDGET)}/day
            </span>
          </div>
          <div className="bar-chart">
            <div className="budget-line" style={{ bottom: `${Math.min(98, budgetPct)}%` }} />
            {dailyBars.map((bar, i) => (
              <div
                key={i}
                className="bar-chart-bar"
                style={{ height: `${bar.height}%`, background: bar.bg, opacity: bar.opacity }}
              />
            ))}
          </div>
          <div className="bar-chart-footer">
            <span>{monthLabel(month).split(' ')[0]} 1</span>
            <span>{monthLabel(month).split(' ')[0]} {totalDays}</span>
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
