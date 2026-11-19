import { ACCOUNTS, ACCOUNT_NAMES } from '../../constants/categories.js'

// Category filter model (pure helpers, no React).
//
// A "key" identifies one filterable thing. Category keys are
// `${accountId}|${direction}|${trimmed lower-case name}` (matches the DB's
// lower(name) uniqueness per account + list). All transfers share the single
// key 'transfer' and are matched by `is_transfer`, never by category name.
// The page keeps a Set of HIDDEN keys, so new categories default to visible.

export const TRANSFER_KEY = 'transfer'
export const UNCATEGORIZED = 'Uncategorized'

export function categoryKey(accountId, direction, name) {
  return `${Number(accountId)}|${direction}|${String(name ?? '').trim().toLowerCase()}`
}

export function txnKey(txn) {
  return txn.is_transfer ? TRANSFER_KEY : categoryKey(txn.account_id, txn.direction, txn.category)
}

export function categoryLabel(name) {
  const trimmed = String(name ?? '').trim()
  return trimmed || UNCATEGORIZED
}

const DIRECTIONS = [
  ['out', 'Money out'],
  ['in', 'Money in'],
]

// Accounts (Spending first) -> directions (out, then in) -> items. Context
// categories come first in their own order; categories seen only in the loaded
// transactions (defensive: orphaned/renamed) are appended alphabetically.
// Empty directions/accounts are omitted. `scope` is 'all' or an account id
// (string or number).
export function buildGroups({ outgoingFor, incomingFor, transactions, scope }) {
  const accountIds = Object.values(ACCOUNTS).filter((id) => scope === 'all' || id === Number(scope))
  return accountIds
    .map((accountId) => {
      const directions = DIRECTIONS.map(([direction, label]) => {
        const list = direction === 'out' ? outgoingFor(accountId) : incomingFor(accountId)
        const seen = new Set()
        const items = []
        for (const c of list) {
          const key = categoryKey(accountId, direction, c.name)
          if (seen.has(key)) continue
          seen.add(key)
          items.push({ key, name: String(c.name ?? ''), label: categoryLabel(c.name) })
        }
        const extras = []
        for (const t of transactions) {
          if (t.is_transfer || Number(t.account_id) !== accountId || t.direction !== direction) continue
          const key = categoryKey(accountId, direction, t.category)
          if (seen.has(key)) continue
          seen.add(key)
          extras.push({ key, name: String(t.category ?? ''), label: categoryLabel(t.category) })
        }
        extras.sort((a, b) => a.label.localeCompare(b.label))
        return { direction, label, items: [...items, ...extras] }
      }).filter((d) => d.items.length > 0)
      return { accountId, name: ACCOUNT_NAMES[accountId], directions }
    })
    .filter((g) => g.directions.length > 0)
}

// Every key the current Account pill can show, Transfers included.
export function scopedKeys(groups) {
  const keys = [TRANSFER_KEY]
  for (const g of groups) for (const d of g.directions) for (const i of d.items) keys.push(i.key)
  return keys
}
