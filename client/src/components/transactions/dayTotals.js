import { ACCOUNT_NAMES } from '../../constants/categories.js'

// The category filter changes which rows are shown and the In/Out sums; it
// never changes the day's balance figures. `running_balance` is computed
// server-side over ALL of the user's rows, so the balance structure (which
// accounts appear, each account's end-of-day balance) comes from `allTxns`,
// while In/Out sums come from `visibleTxns` (a subset of allTxns; pass the same
// array when no filter applies).
export function computeDayTotals(allTxns, visibleTxns = allTxns) {
  const combined = { in: 0, out: 0 }
  const perAccount = {}
  const endOfDayBalance = {}

  for (const txn of allTxns) {
    if (!perAccount[txn.account_id]) {
      perAccount[txn.account_id] = { accountId: txn.account_id, in: 0, out: 0 }
    }
    // txns are in chronological order, so the last one seen per account
    // holds that account's end-of-day running balance.
    endOfDayBalance[txn.account_id] = txn.running_balance
  }

  for (const txn of visibleTxns) {
    if (txn.is_transfer) continue
    combined[txn.direction] += txn.amount
    perAccount[txn.account_id][txn.direction] += txn.amount
  }

  return {
    combined,
    perAccount: Object.values(perAccount).map((a) => ({
      ...a,
      name: ACCOUNT_NAMES[a.accountId],
      endOfDayBalance: endOfDayBalance[a.accountId],
    })),
  }
}
