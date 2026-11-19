import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client.js'
import TransactionList from '../components/transactions/TransactionList.jsx'
import ThresholdLegend from '../components/transactions/ThresholdLegend.jsx'
import TransactionModal from '../components/transactions/TransactionModal.jsx'
import ExportModal from '../components/transactions/ExportModal.jsx'
import ClearHistoryModal from '../components/transactions/ClearHistoryModal.jsx'
import CategoryManagerModal from '../components/transactions/CategoryManagerModal.jsx'
import CategoryFilter from '../components/transactions/CategoryFilter.jsx'
import { categoryKey, txnKey, TRANSFER_KEY } from '../components/transactions/categoryFilter.js'
import MonthSwitcher from '../components/layout/MonthSwitcher.jsx'
import AddFab from '../components/layout/AddFab.jsx'
import { currentMonthStr, monthRangeFor, monthLabel } from '../utils/dateUtils.js'
import { formatCurrency } from '../utils/format.js'
import { ACCOUNTS, ACCOUNT_NAMES } from '../constants/categories.js'
import { useTransactionActivity } from '../contexts/transactionActivity.js'

const ACCOUNT_FILTERS = [['all', 'All'], ...Object.entries(ACCOUNT_NAMES)]

export default function TransactionsPage() {
  const activity = useTransactionActivity()
  const [month, setMonth] = useState(currentMonthStr())
  const [accountFilter, setAccountFilter] = useState('all')
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('normal')
  const [exportOpen, setExportOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [catManagerOpen, setCatManagerOpen] = useState(false)
  // Status banner slot: { text, action?: { label, onClick }, hiddenByFilter? }.
  const [banner, setBanner] = useState(null)
  // Category keys the user has unticked (see components/transactions/categoryFilter.js).
  // Session-only; persists across month/account changes, ignored by Export.
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set())
  const catTriggerRef = useRef(null)

  // Latest-request-wins: a response is dropped if a newer request has started,
  // so a slow older fetch can't overwrite newer state (month/filter changes,
  // back-to-back mutations).
  const txReqId = useRef(0)
  const acctReqId = useRef(0)

  const loadTransactions = useCallback(async () => {
    const reqId = ++txReqId.current
    setLoading(true)
    const { from, to } = monthRangeFor(month)
    const accountId = accountFilter === 'all' ? undefined : accountFilter
    const data = await api.getTransactions({ from, to, accountId })
    if (reqId !== txReqId.current) return
    setTransactions(data)
    setLoading(false)
  }, [month, accountFilter])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  const refreshAccounts = useCallback(async () => {
    const reqId = ++acctReqId.current
    const data = await api.getAccounts()
    if (reqId !== acctReqId.current) return
    setAccounts(data)
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  // Every balance-affecting mutation (create, transfer, edit, delete, clear)
  // refreshes the list, the account balances and the activity indicator together.
  async function refreshAfterMutation() {
    await Promise.all([loadTransactions(), refreshAccounts(), activity.refetch()])
  }

  function handleFilterChange(next) {
    setHiddenKeys(next)
    // A "hidden by your filter" notice goes stale as soon as the filter moves.
    setBanner((b) => (b?.hiddenByFilter ? null : b))
  }

  function showAllCategories() {
    handleFilterChange(new Set())
    catTriggerRef.current?.focus()
  }

  // After a save/create, tell the user when the row they just wrote is not
  // visible because of the category filter (or clear a stale such notice).
  // Non-transfer rows in an account the Account pill excludes aren't shown
  // regardless of the filter, so they don't get the notice.
  function noteIfHidden(key, accountId) {
    const inScope = key === TRANSFER_KEY || accountFilter === 'all' || Number(accountFilter) === Number(accountId)
    if (inScope && hiddenKeys.has(key)) {
      setBanner({
        text: 'Saved. This transaction is hidden by your category filter.',
        hiddenByFilter: true,
        action: { label: 'Show all', onClick: showAllCategories },
      })
    } else {
      setBanner((b) => (b?.hiddenByFilter ? null : b))
    }
  }

  async function handleCreateTransaction(data) {
    await api.createTransaction(data)
    await refreshAfterMutation()
    noteIfHidden(categoryKey(data.account_id, data.direction, data.category), data.account_id)
  }

  async function handleCreateTransfer(data) {
    await api.createTransfer(data)
    await refreshAfterMutation()
    noteIfHidden(TRANSFER_KEY)
  }

  async function handleSaveEdit(id, data) {
    const original = transactions.find((t) => t.id === id)
    await api.updateTransaction(id, data)
    setEditingId(null)
    await refreshAfterMutation()
    if (!original) return
    // Transfers send no category; keep the row's own key for them.
    const key = original.is_transfer || data.category === undefined
      ? txnKey(original)
      : categoryKey(original.account_id, original.direction, data.category)
    noteIfHidden(key, original.account_id)
  }

  async function handleDelete(txn) {
    const confirmMsg = txn.is_transfer
      ? 'Delete this transfer? Both linked legs will be removed.'
      : 'Delete this transaction?'
    if (!window.confirm(confirmMsg)) return
    await api.deleteTransaction(txn.id)
    await refreshAfterMutation()
  }

  function openModal(mode) {
    setModalMode(mode)
    setModalOpen(true)
  }

  async function handleCleared() {
    setClearOpen(false)
    await refreshAfterMutation()
    setBanner({ text: 'All transaction history has been deleted.' })
  }

  return (
    <div className="page-animate tx">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Transactions</h1>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn page-add-btn" onClick={() => openModal('normal')}>+ Transaction</button>
          <AddFab onClick={() => openModal('normal')} />
          <button type="button" className="btn btn-secondary" onClick={() => openModal('transfer')}>⇄ Transfer</button>
          <button type="button" className="btn btn-secondary tx-btn-plain" onClick={() => setExportOpen(true)}>Export</button>
          <button type="button" className="btn btn-secondary tx-btn-plain" onClick={() => setCatManagerOpen(true)}>Manage categories</button>
          <span className="page-header-actions-divider" aria-hidden="true" />
          <button type="button" className="btn-danger" onClick={() => setClearOpen(true)}>Clear all history</button>
        </div>
      </div>

      {banner && (
        <div className="status-banner" role="status">
          {banner.text}
          {banner.action && (
            <button type="button" className="btn-ghost status-banner-action" onClick={banner.action.onClick}>
              {banner.action.label}
            </button>
          )}
        </div>
      )}

      <div className="filter-strip">
        <MonthSwitcher
          month={month}
          onChange={setMonth}
          showActivityIndicator
          showJumpToEarliest
          activity={accountFilter === 'all' ? activity.all : activity.byAccount[accountFilter]}
        />
        <CategoryFilter
          transactions={transactions}
          scope={accountFilter}
          hiddenKeys={hiddenKeys}
          onChange={handleFilterChange}
          triggerRef={catTriggerRef}
        />
        <div className="filter-strip-account">
          <span className="filter-strip-label">Account</span>
          <div className="pill-group">
            {ACCOUNT_FILTERS.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={`pill-btn ${accountFilter === id ? 'active' : ''}`}
                onClick={() => setAccountFilter(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tx-signals-row">
        <div className="tx-signals">
          <ThresholdLegend />
        </div>

        <div className="account-summary-strip">
          {accounts.map((account) => (
            <div className="account-summary-item" key={account.id}>
              <span className="account-summary-label">
                <span
                  className="tx-acct-dot"
                  style={{ background: account.id === ACCOUNTS.SAVINGS ? 'var(--pink)' : 'var(--sky)' }}
                  aria-hidden="true"
                />
                {account.name} balance
              </span>
              <span className="account-summary-value">{formatCurrency(account.balance)}</span>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-placeholder"><p>Loading...</p></div>
      ) : (
        <TransactionList
          transactions={transactions}
          editingId={editingId}
          isVisible={(txn) => !hiddenKeys.has(txnKey(txn))}
          onShowAll={showAllCategories}
          onEdit={setEditingId}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setEditingId(null)}
          onDelete={handleDelete}
        />
      )}

      {modalOpen && (
        <TransactionModal
          initialMode={modalMode}
          onClose={() => setModalOpen(false)}
          onCreateTransaction={handleCreateTransaction}
          onCreateTransfer={handleCreateTransfer}
        />
      )}

      {exportOpen && (
        <ExportModal month={month} activity={activity.all} onClose={() => setExportOpen(false)} />
      )}

      {clearOpen && (
        <ClearHistoryModal onClose={() => setClearOpen(false)} onCleared={handleCleared} />
      )}

      {catManagerOpen && (
        <CategoryManagerModal
          initialAccountId={accountFilter === 'all' ? ACCOUNTS.SPENDING : Number(accountFilter)}
          onClose={() => setCatManagerOpen(false)}
        />
      )}
    </div>
  )
}
