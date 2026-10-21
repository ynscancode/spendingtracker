import { ACCOUNTS, ACCOUNT_NAMES } from '../constants/categories.js'

// Neutral gray for transfer segments (same token Recent activity uses for
// transfer dots), so a transfer never reads as a real category.
const TRANSFER_COLOR = 'var(--faint)'

// Single source of truth for "real money movement across both accounts":
// non-transfer rows only. Both the Combined donuts and the Monthly insights
// money in / money out use this, so they cannot drift apart.
export function realFlows(transactions, direction) {
  return transactions.filter((t) => !t.is_transfer && t.direction === direction)
}

export function sumAmounts(transactions) {
  return transactions.reduce((s, t) => s + t.amount, 0)
}

// Combined view: both accounts as one pot, transfers excluded. Categories
// are per-account, so rows group by (account_id, category); the account name
// is appended to the label only when the same name (case-insensitive) shows
// up for both accounts in this donut. `key` is always unique.
export function combinedBreakdown(transactions, direction, colorFor) {
  const groups = new Map()
  realFlows(transactions, direction).forEach((t) => {
    const key = `${t.account_id}:${t.category}`
    const g = groups.get(key) || { key, accountId: t.account_id, category: t.category, value: 0 }
    g.value += t.amount
    groups.set(key, g)
  })
  const accountsByName = new Map()
  groups.forEach((g) => {
    const lower = g.category.toLowerCase()
    if (!accountsByName.has(lower)) accountsByName.set(lower, new Set())
    accountsByName.get(lower).add(g.accountId)
  })
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      category: accountsByName.get(g.category.toLowerCase()).size > 1
        ? `${g.category} (${ACCOUNT_NAMES[g.accountId] ?? 'Account'})`
        : g.category,
      value: g.value,
      color: colorFor(g.accountId, g.category),
    }))
    .sort((a, b) => b.value - a.value)
}

// Per-account view: real categories plus ONE neutral transfer segment per
// direction, so in - out equals the account's net balance change for the
// month. The transfer segment is labelled with the counterpart account
// ("From Savings" / "To Spending"), whatever its stored category value.
export function accountBreakdown(transactions, accountId, direction, colorFor) {
  const totals = new Map()
  let transferTotal = 0
  transactions.forEach((t) => {
    if (t.account_id !== accountId || t.direction !== direction) return
    if (t.is_transfer) {
      transferTotal += t.amount
    } else {
      totals.set(t.category, (totals.get(t.category) || 0) + t.amount)
    }
  })
  const rows = [...totals.entries()].map(([category, value]) => ({
    key: `c:${category}`,
    category,
    value,
    color: colorFor(accountId, category),
  }))
  if (transferTotal > 0) {
    const otherId = accountId === ACCOUNTS.SPENDING ? ACCOUNTS.SAVINGS : ACCOUNTS.SPENDING
    const otherName = ACCOUNT_NAMES[otherId]
    rows.push({
      key: 'transfer',
      category: direction === 'in' ? `From ${otherName}` : `To ${otherName}`,
      value: transferTotal,
      color: TRANSFER_COLOR,
    })
  }
  return rows.sort((a, b) => b.value - a.value)
}
