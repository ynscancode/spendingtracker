import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'
import TransactionList from '../components/transactions/TransactionList.jsx'
import TransactionModal from '../components/transactions/TransactionModal.jsx'
import ImportModal from '../components/imports/ImportModal.jsx'
import MonthSwitcher from '../components/layout/MonthSwitcher.jsx'
import { currentMonthStr, monthRangeFor, monthLabel } from '../utils/dateUtils.js'
import { formatCurrency } from '../utils/format.js'
import { ACCOUNT_NAMES } from '../constants/categories.js'

const ACCOUNT_FILTERS = [['all', 'All'], ...Object.entries(ACCOUNT_NAMES)]

export default function TransactionsPage() {
  const [month, setMonth] = useState(currentMonthStr())
  const [accountFilter, setAccountFilter] = useState('all')
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('normal')
  const [importOpen, setImportOpen] = useState(false)

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    const { from, to } = monthRangeFor(month)
    const accountId = accountFilter === 'all' ? undefined : accountFilter
    const data = await api.getTransactions({ from, to, accountId })
    setTransactions(data)
    setLoading(false)
  }, [month, accountFilter])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  useEffect(() => {
    api.getAccounts().then(setAccounts)
  }, [])

  function refreshAccounts() {
    api.getAccounts().then(setAccounts)
  }

  async function handleCreateTransaction(data) {
    await api.createTransaction(data)
    await loadTransactions()
    refreshAccounts()
  }

  async function handleCreateTransfer(data) {
    await api.createTransfer(data)
    await loadTransactions()
    refreshAccounts()
  }

  async function handleSaveEdit(id, data) {
    await api.updateTransaction(id, data)
    setEditingId(null)
    await loadTransactions()
  }

  async function handleDelete(txn) {
    const confirmMsg = txn.is_transfer
      ? 'Delete this transfer? Both linked legs will be removed.'
      : 'Delete this transaction?'
    if (!window.confirm(confirmMsg)) return
    await api.deleteTransaction(txn.id)
    await loadTransactions()
    refreshAccounts()
  }

  function openModal(mode) {
    setModalMode(mode)
    setModalOpen(true)
  }

  async function handleImported() {
    await loadTransactions()
    refreshAccounts()
  }

  return (
    <div className="page-animate">
      <div className="page-header-row">
        <div>
          <div className="page-eyebrow">{monthLabel(month)}</div>
          <h1 className="page-title">Transactions</h1>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn" onClick={() => openModal('normal')}>+ Transaction</button>
          <button type="button" className="btn btn-secondary" onClick={() => openModal('transfer')}>⇄ Transfer</button>
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>Import</button>
        </div>
      </div>

      <div className="filter-strip">
        <MonthSwitcher month={month} onChange={setMonth} />
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

      <div className="account-summary-strip">
        {accounts.map((account) => (
          <div className="account-summary-item" key={account.id}>
            <span className="account-summary-label">{account.name} balance</span>
            <span className="account-summary-value">{formatCurrency(account.balance)}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading-placeholder"><p>Loading...</p></div>
      ) : (
        <TransactionList
          transactions={transactions}
          editingId={editingId}
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

      {importOpen && (
        <ImportModal onClose={() => setImportOpen(false)} onImported={handleImported} />
      )}
    </div>
  )
}
