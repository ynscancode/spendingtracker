import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { api } from '../api/client.js'
import { todayStr, currentMonthStr, monthRangeFor, monthLabel, dayLabel } from '../utils/dateUtils.js'
import { formatCurrency, formatSigned, formatOutflow } from '../utils/format.js'
import { computeDailyInsights } from '../utils/insights.js'
import { ACCOUNTS } from '../constants/categories.js'
import { useDailyBudget } from '../hooks/useDailyBudget.js'
import { useCategories } from '../contexts/categories.js'
import { useCategoryColor } from '../hooks/useCategoryColor.js'
import { useTransactionActivity } from '../contexts/transactionActivity.js'
import MonthSwitcher from '../components/layout/MonthSwitcher.jsx'
import AddFab from '../components/layout/AddFab.jsx'
import TransactionModal from '../components/transactions/TransactionModal.jsx'
import DonutChart from '../components/breakdown/DonutChart.jsx'
import { buildDonutSegments } from '../utils/donutMath.js'
import CategoryBarList from '../components/breakdown/CategoryBarList.jsx'
import BreakdownControls from '../components/breakdown/BreakdownControls.jsx'
import BreakdownViewSwitch from '../components/breakdown/BreakdownViewSwitch.jsx'
import { realFlows, sumAmounts, combinedBreakdown, accountBreakdown } from '../utils/breakdown.js'
import { suffixFor, classifyBudgetHealth } from '../utils/budgetHealth.js'

function daysInMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

// Budget health -> Colour Block tone (lime = under, yellow = near, tomato = over).
const HEALTH_TONE = { under: 'lime', near: 'yellow', over: 'tomato' }

// Simple two-bar money-in vs money-out comparison for the selected view, scaled
// relative to whichever of the two totals is larger. Bars are vertical to
// sit naturally alongside the donut pair above. Always shows both labels
// and dollar values so the comparison isn't color-only.
function InOutCompareCard({ totalIn, totalOut }) {
  const max = Math.max(totalIn, totalOut)
  const heightFor = (value) => (max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4)
  return (
    <div className="card">
      <h2>In vs. out</h2>
      <div className="inout-compare">
        <div className="inout-compare-bar-col">
          <div className="inout-compare-track">
            <div
              className="inout-compare-fill"
              style={{ height: `${heightFor(totalOut)}%`, background: 'var(--tomato)' }}
            />
          </div>
          <div className="inout-compare-value">{formatCurrency(totalOut)}</div>
          <div className="inout-compare-label">Money out</div>
        </div>
        <div className="inout-compare-bar-col">
          <div className="inout-compare-track">
            <div
              className="inout-compare-fill"
              style={{ height: `${heightFor(totalIn)}%`, background: 'var(--lime)' }}
            />
          </div>
          <div className="inout-compare-value">{formatCurrency(totalIn)}</div>
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
    <div className="card">
      <div className="donut-card-head">
        <h2><span className="ov-chip ov-chip--fill ov-chip--icon" style={{ background: iconColor }}>{icon}</span> {label}</h2>
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
  const { outgoingFor } = useCategories()
  const colorFor = useCategoryColor()
  const activity = useTransactionActivity()
  const [accounts, setAccounts] = useState([])
  const [monthTransactions, setMonthTransactions] = useState([])
  const [breakdownTransactions, setBreakdownTransactions] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr())
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [breakdownMode, setBreakdownMode] = useState('both')
  const [breakdownView, setBreakdownView] = useState('combined')
  const [dailyBudget, setDailyBudget] = useDailyBudget()
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')

  // Overview is Spending-only by design — there is no account selector on
  // this page. Exceptions: the Breakdown section (own Combined | Spending |
  // Savings view switch, default Combined) and the Monthly insights money
  // in/out/net/savings-rate figures (Combined, both accounts), which
  // aren't Spending-scoped. The daily spending bars stay Spending-only.
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
  const savingsDelta = netDeltaForAccount(ACCOUNTS.SAVINGS)
  const netDelta = netDeltaForAccount(ACCOUNTS.SPENDING) + netDeltaForAccount(ACCOUNTS.SAVINGS)

  // Everything below is scoped to the selected account.
  const scopedTransactions = monthTransactions.filter((t) => t.account_id === scopeAccountId)
  // Breakdown-scoped equivalent (selectedMonth, not the page's current
  // month), Spending-only: drives just the Monthly insights daily bar chart.
  const scopedBreakdownTransactions = breakdownTransactions.filter((t) => t.account_id === scopeAccountId)

  // Monthly insights money in/out/net: real money movement across BOTH
  // accounts (Combined), excludes transfers (distinct from the balance-delta
  // figures above, which intentionally include transfers). Uses the same
  // realFlows filter as the Combined donuts. Scoped to selectedMonth, not
  // the page's current month. The daily spending bar chart below stays
  // Spending-only.
  const sumIn = sumAmounts(realFlows(breakdownTransactions, 'in'))
  const sumOut = sumAmounts(realFlows(breakdownTransactions, 'out'))
  const net = sumIn - sumOut
  const savingsRate = sumIn > 0 ? Math.round((net / sumIn) * 100) : 0

  const insights = computeDailyInsights(scopedTransactions, { todayDate: today, dailyBudget })
  const hasDailyBudget = dailyBudget !== null

  // Tile tone follows the Colour Block palette: Spent today = lime, Daily
  // average = sky, the other two stay on the plain card. Text on a coloured
  // fill is always dark (--onc), so over/under is carried by the note's
  // wording rather than a red/green text colour. The Spent today meter reuses
  // values already on hand (spent today vs the daily budget) and only renders
  // when a positive daily budget exists.
  const dailyInsightTiles = [
    {
      label: 'Spent today',
      tone: 'lime',
      value: formatCurrency(insights.spentToday),
      meterPct: hasDailyBudget && dailyBudget > 0 ? Math.min(100, (insights.spentToday / dailyBudget) * 100) : null,
      note: hasDailyBudget
        ? `${formatCurrency(insights.spentTodayNoteAmount)} ${insights.spentTodayNote}`
        : '—',
    },
    {
      label: 'Daily average',
      tone: 'sky',
      value: formatCurrency(insights.dailyAverage),
      meterPct: null,
      note: hasDailyBudget
        ? `${insights.dailyAveragePct}% ${insights.dailyAverageOver ? 'above target' : 'under target'}`
        : 'No daily budget set',
    },
    {
      label: 'Busiest day',
      tone: null,
      value: formatCurrency(insights.busiestDayAmount),
      meterPct: null,
      note: insights.busiestDayLabel,
    },
    {
      label: 'Projected month',
      tone: null,
      value: formatCurrency(insights.projectedMonth),
      meterPct: null,
      note: hasDailyBudget
        ? `${insights.daysOnBudget} of ${insights.daysConsidered} days on budget`
        : 'No daily budget set',
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
      dayBiggestMap[d] = { amount: t.amount, category: t.category, color: colorFor(t.account_id, t.category, 'out') }
    }
  })
  const totalDays = daysInMonth(selectedMonth)
  // When no daily budget is set, scale off actual max spend only — no
  // budget reference line to draw, and no "over" coloring since
  // there's nothing to exceed.
  const maxDay = hasDailyBudget
    ? Math.max(1, dailyBudget, ...Object.values(dayMap))
    : Math.max(1, ...Object.values(dayMap))
  const budgetPct = hasDailyBudget ? (dailyBudget / maxDay) * 100 : null
  const todayDayNumber = selectedMonth === month ? Number(today.slice(8, 10)) : null
  const dailyBars = Array.from({ length: totalDays }, (_, i) => {
    const v = dayMap[i + 1] || 0
    const h = Math.max(2, Math.round((v / maxDay) * 100))
    const over = hasDailyBudget && v > dailyBudget
    // Bar tone: over the daily budget = tomato, today (current month only) =
    // lime, any other spend day = sky, no spend = flat soft stub.
    const tone = v === 0 ? 'empty' : over ? 'over' : (i + 1 === todayDayNumber ? 'today' : 'default')
    return { height: h, tone, total: v, biggest: dayBiggestMap[i + 1] || null, day: i + 1 }
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
    const health = classifyBudgetHealth(actual, b.amount)
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
    .map(([category, value]) => ({ category, value, color: colorFor(scopeAccountId, category, 'out') }))
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
        isTransfer,
        color: isTransfer ? 'var(--card)' : colorFor(t.account_id, t.category, t.direction),
        comment: isTransfer ? 'Transfer' : t.comment,
        category: isTransfer ? 'Transfer' : t.category,
        meta: dayLabel(t.date),
        amountText: formatSigned(signed),
        amountColor: signed >= 0 ? 'var(--green)' : 'var(--text)',
      }
    })

  // Breakdown section: one donut pair driven by the Combined | Spending |
  // Savings switch, unaffected by the page being Spending-scoped elsewhere.
  // Combined = both accounts as one pot, transfers excluded (same filter as
  // Monthly insights). Spending/Savings = that account only, with transfers
  // shown as a neutral segment so in - out equals its net balance change.
  // Scoped to selectedMonth via breakdownTransactions, not the page's
  // current month.
  // breakdown.js calls colorFor(accountId, name); bind the direction here so
  // a name present in both an account's outgoing and incoming lists resolves
  // against the right one.
  const outColor = (accountId, name) => colorFor(accountId, name, 'out')
  const inColor = (accountId, name) => colorFor(accountId, name, 'in')
  let viewOut
  let viewIn
  if (breakdownView === 'combined') {
    viewOut = combinedBreakdown(breakdownTransactions, 'out', outColor)
    viewIn = combinedBreakdown(breakdownTransactions, 'in', inColor)
  } else {
    const viewAccountId = breakdownView === 'savings' ? ACCOUNTS.SAVINGS : ACCOUNTS.SPENDING
    viewOut = accountBreakdown(breakdownTransactions, viewAccountId, 'out', outColor)
    viewIn = accountBreakdown(breakdownTransactions, viewAccountId, 'in', inColor)
  }
  const viewTotalOut = viewOut.reduce((s, c) => s + c.value, 0)
  const viewTotalIn = viewIn.reduce((s, c) => s + c.value, 0)
  // Per-account views include transfers, so "Earned" would mislabel them.
  const outCenterLabel = breakdownView === 'combined' ? 'Spent' : 'Out'
  const inCenterLabel = breakdownView === 'combined' ? 'Earned' : 'In'

  const monthShortLabel = monthLabel(selectedMonth).split(' ')[0]

  const hasSpendingCategories = outgoingFor(ACCOUNTS.SPENDING).length > 0
  const budgetPillTone = HEALTH_TONE[classifyBudgetHealth(totalSpentBudgeted, totalBudgeted)]

  return (
    <div className="page-animate ov">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn page-add-btn" onClick={() => setModalOpen(true)}>+ Add transaction</button>
          <AddFab onClick={() => setModalOpen(true)} />
        </div>
      </div>

      <section className="ov-today">
        <div className="ov-today-row">
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
              <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="ov-stats">
          {dailyInsightTiles.map((tile) => (
            <div className={`ov-stat${tile.tone ? ` ov-stat--${tile.tone}` : ''}`} key={tile.label}>
              <div className="ov-stat-label">{tile.label}</div>
              <div className="ov-stat-value">{tile.value}</div>
              {tile.meterPct !== null && (
                <div className="ov-meter" aria-hidden="true"><i style={{ width: `${tile.meterPct}%` }} /></div>
              )}
              <div className={`ov-stat-note${tile.tone ? '' : ' ov-stat-note--muted'}`}>{tile.note}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="card">
        <div className="card-row">
          <h2>Budget</h2>
          <div className="ov-legend">
            {hasSpendingCategories && (
              <>
                <span className="ov-chip ov-chip--lime">Under</span>
                <span className="ov-chip ov-chip--yellow">Near</span>
                <span className="ov-chip ov-chip--tomato">Over</span>
              </>
            )}
            {totalBudgeted > 0 && (
              <span className={`ov-chip ov-chip--${budgetPillTone}`}>
                {budgetUsedPct}% of budget used
              </span>
            )}
          </div>
        </div>
        <div className="ov-sum">
          <div className="ov-sumbox">
            <div>
              <div className="ov-lbl">Total budgeted</div>
              <div className="ov-big">{formatCurrency(totalBudgeted)}</div>
            </div>
            <span className="ov-sub">Across {budgetRows.length} categories</span>
          </div>
          <div className="ov-sumbox">
            <div>
              <div className="ov-lbl">Total spent</div>
              <div className="ov-big">{formatCurrency(totalSpentBudgeted)}</div>
            </div>
            {totalBudgeted > 0
              ? <span className={`ov-chip ov-chip--${budgetPillTone}`}>{budgetUsedPct}% of budget</span>
              : <span className="ov-sub">No budget to compare</span>}
          </div>
        </div>

        {!hasSpendingCategories ? (
          <p className="empty-text" style={{ marginTop: 16 }}>
            No Spending categories to budget yet.
          </p>
        ) : (
          <div className="ov-brows">
            {chartRows.map((row) => {
              const suffix = suffixFor(row.health)
              const displayPct = Number.isFinite(row.pct) ? row.pct : 100
              return (
                <div className="ov-brow" key={row.category}>
                  <div className="ov-brow-head">
                    <span className="ov-chip ov-chip--fill ov-chip--cat" style={{ background: colorFor(ACCOUNTS.SPENDING, row.category, 'out') }}>
                      {row.category}
                    </span>
                    <span className="ov-brow-value" style={{ color: row.health === 'over' ? 'var(--red)' : 'var(--muted)' }}>
                      {formatCurrency(row.actual)} of {formatCurrency(row.budget)} ({displayPct}%)
                      {suffix && <span style={{ color: suffix.color }}>{suffix.text}</span>}
                    </span>
                  </div>
                  <div className="ov-track">
                    <i
                      className={`ov-fill ov-fill--${row.health}${displayPct === 0 ? ' ov-fill--zero' : ''}`}
                      style={{ width: `${Math.min(100, displayPct)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="ov-balances">
        <div className="balance-card">
          <div className="balance-card-split">
            <div className="balance-card-col">
              <div className="balance-card-label">
                <span className="balance-card-dot" style={{ background: 'var(--sky)' }} />
                Spending balance
              </div>
              <div className="ov-balrow">
                <div className="balance-card-value">{formatCurrency(scopedBal)}</div>
                <span className={`ov-chip ${scopedDelta >= 0 ? 'ov-chip--lime' : 'ov-chip--tomato'}`}>
                  {formatSigned(scopedDelta)} this month
                </span>
              </div>
            </div>
            <div className="balance-card-col balance-card-col-secondary">
              <div className="balance-card-label">
                <span className="balance-card-dot" style={{ background: 'var(--pink)' }} />
                Savings
              </div>
              <div className="ov-balrow">
                <div className="balance-card-value">{formatCurrency(savingsAccount?.balance ?? 0)}</div>
                <span className={`ov-chip ${savingsDelta >= 0 ? 'ov-chip--lime' : 'ov-chip--tomato'}`}>
                  {formatSigned(savingsDelta)} this month
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="balance-card accent">
          <div className="balance-card-label">Net worth</div>
          <div className="ov-balrow">
            <div className="balance-card-value">{formatCurrency(netWorth)}</div>
            <span className={`ov-chip ${netDelta >= 0 ? 'ov-chip--lime' : 'ov-chip--tomato'}`}>
              {formatSigned(netDelta)} this month
            </span>
          </div>
        </div>
      </div>

      <div className="two-col-grid">
        <div className="card">
          <h2>Top spending</h2>
          <div className="ov-hbars">
            {topCats.length === 0 ? (
              <p className="empty-text">No spending yet this month.</p>
            ) : topCats.map((c) => {
              const w = Math.max(3, Math.round((c.value / maxCat) * 100))
              return (
                <div className="ov-hbar" key={c.category}>
                  <div className="ov-hbar-head">
                    <span className="ov-hbar-label">
                      <span className="ov-hbar-swatch" style={{ background: c.color }} aria-hidden="true" />
                      <span className="ov-hbar-name">{c.category}</span>
                    </span>
                    <span className="ov-hbar-value">{formatCurrency(c.value)}</span>
                  </div>
                  <div className="ov-hbar-track">
                    <i style={{ width: `${w}%`, background: c.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <h2>Recent activity</h2>
          <div className="ov-acts">
            {recent.length === 0 ? (
              <p className="empty-text">No transactions yet this month.</p>
            ) : recent.map((r) => (
              <div className="ov-act" key={r.id}>
                <span
                  className={`ov-badge${r.isTransfer ? ' ov-badge--transfer' : ''}`}
                  style={{ background: r.color }}
                  aria-hidden="true"
                >
                  {(r.category || '?').charAt(0).toUpperCase()}
                </span>
                <div className="ov-act-main">
                  <div className="ov-act-comment">{r.comment}</div>
                  <div className="ov-act-meta">{r.category} · {r.meta}</div>
                </div>
                <div className="ov-act-amount" style={{ color: r.amountColor }}>{r.amountText}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ov-breakdown-head">
        <h2 className="ov-breakdown-title">Breakdown</h2>
        <div className="breakdown-heading-controls">
          <BreakdownViewSwitch view={breakdownView} onViewChange={setBreakdownView} />
          <MonthSwitcher
            month={selectedMonth}
            onChange={setSelectedMonth}
            showActivityIndicator
            activity={activity.all}
          />
          <BreakdownControls mode={breakdownMode} onModeChange={setBreakdownMode} />
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <h2>Monthly insights</h2>
          <span className={`ov-chip ${savingsRate < 0 ? 'ov-chip--tomato' : 'ov-chip--lime'}`}>Savings rate {savingsRate}%</span>
        </div>
        <div className="money-flow-grid">
          <div className="ov-flow ov-flow--in">
            <div className="money-flow-label">Money in</div>
            <div className="money-flow-value">{formatCurrency(sumIn)}</div>
          </div>
          <div className="ov-flow ov-flow--out">
            <div className="money-flow-label">Money out</div>
            <div className="money-flow-value">{formatCurrency(sumOut)}</div>
          </div>
          <div className="ov-flow">
            <div className="money-flow-label">Net</div>
            <div className="money-flow-value" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatSigned(net)}</div>
          </div>
        </div>

        <div className="ov-daily">
          <div className="daily-spending-header">
            <span className="money-flow-label">Daily spending</span>
            <span className="ov-chip">
              {hasDailyBudget ? `Budget ${formatCurrency(dailyBudget)}/day` : 'No daily budget'}
            </span>
          </div>
          <div className="bar-chart">
            {hasDailyBudget && (
              <div className="budget-line" style={{ bottom: `${Math.min(98, budgetPct)}%` }} />
            )}
            {dailyBars.map((bar, i) => {
              // Edge-anchored tooltip alignment: a centered tooltip only fits
              // when the bar is far enough from each chart edge - on a narrow
              // (mobile) chart that's roughly the outer ~24% of bars on each
              // side. Bars in that outer band get a left/right-anchored
              // tooltip (grows inward, never past the chart edge); the middle
              // ~50% keep the base centered style. (ARCH-0015)
              const tooltipAlign =
                i < dailyBars.length * 0.25 ? 'left' : i > dailyBars.length * 0.75 ? 'right' : 'center';
              const tooltipClassName =
                tooltipAlign === 'center' ? 'bar-chart-tooltip' : `bar-chart-tooltip bar-chart-tooltip--${tooltipAlign}`;
              return (
              <div
                key={i}
                className="bar-chart-bar-wrap"
              >
                <div
                  className={`bar-chart-bar bar-chart-bar--${bar.tone}`}
                  style={{ height: `${bar.height}%` }}
                />
                <div className={tooltipClassName} role="tooltip">
                  <div className="bar-chart-tooltip-day">{monthShortLabel} {bar.day}</div>
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
              );
            })}
          </div>
          <div className="bar-chart-footer">
            <span>{monthShortLabel} 1</span>
            <span>{monthShortLabel} {totalDays}</span>
          </div>
        </div>
      </div>

      <div className="two-col-grid">
        <DonutCard icon="↑" iconColor="var(--tomato)" label="Money out" centerLabel={outCenterLabel} cats={viewOut} mode={breakdownMode} />
        <DonutCard icon="↓" iconColor="var(--lime)" label="Money in" centerLabel={inCenterLabel} cats={viewIn} mode={breakdownMode} />
      </div>
      <InOutCompareCard totalIn={viewTotalIn} totalOut={viewTotalOut} />

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
