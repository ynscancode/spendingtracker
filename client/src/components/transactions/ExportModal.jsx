import { useState } from 'react'
import { createPortal } from 'react-dom'
import MonthSwitcher from '../layout/MonthSwitcher.jsx'
import { monthRangeFor, monthLabel } from '../../utils/dateUtils.js'
import { apiUrl } from '../../api/client.js'

// Mirrors the portal/overlay/panel conventions of TransactionModal.jsx and
// ClearHistoryModal.jsx (.modal-overlay / .modal-panel / .modal-head /
// .modal-actions), so it looks and behaves consistently with every other
// modal in the app. `month` is the page's currently-viewed month (YYYY-MM),
// used only to seed the in-modal month picker's default value — the user
// can change the export month here without leaving the modal. `activity`
// is the already-fetched `useTransactionActivity()` scope (`{ months,
// earliest, latest }`, see contexts/transactionActivity.js) passed down
// from TransactionsPage — reused as-is, no new backend call, to detect and
// block exporting an empty month.
export default function ExportModal({ month, activity, onClose }) {
  const [scope, setScope] = useState('month')
  const [pickedMonth, setPickedMonth] = useState(month)

  const months = activity?.months || []
  const monthHasData = months.includes(pickedMonth)
  const hasAnyHistory = months.length > 0
  const monthEmpty = scope === 'month' && !monthHasData
  const allEmpty = scope === 'all' && !hasAnyHistory
  const exportDisabled = monthEmpty || allEmpty

  function handleExport() {
    if (exportDisabled) return
    // Direct same-origin anchor navigation to the export endpoint — NOT a
    // fetch()/blob()/createObjectURL() round trip. That path was producing,
    // in real Chrome, a downloaded file named after the blob object-URL's
    // UUID with no extension (the `download` attribute's filename wasn't
    // being honored on a blob: URL in the user's browser). A same-origin GET
    // straight to the endpoint lets the server's own
    // `Content-Disposition: attachment; filename="..."` header drive the
    // download name directly; the `a.download` below is just a same-origin
    // belt-and-suspenders in case that header is ever missing.
    //
    // Uses apiUrl() (same base as api/client.js's request()/requestFormData())
    // rather than a bare relative `/api/...` path: on a static SPA host
    // (Vercel/Netlify) a relative path would hit the frontend's own domain,
    // not the separately-hosted backend, breaking the download in production.
    const params = new URLSearchParams()
    if (scope === 'all') {
      params.set('all', 'true')
    } else {
      const { from, to } = monthRangeFor(pickedMonth)
      params.set('from', from)
      params.set('to', to)
    }
    const filename = scope === 'all' ? 'transactions-all.xlsx' : `transactions-${pickedMonth}.xlsx`
    const link = document.createElement('a')
    link.href = `${apiUrl('/transactions/export')}?${params.toString()}`
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    onClose()
  }

  const portalTarget = document.getElementById('modal-root') || document.body

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Export Transactions</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <label className="form-field">
          Scope
          <div className="pill-group">
            <button
              type="button"
              className={`pill-btn ${scope === 'month' ? 'active' : ''}`}
              onClick={() => setScope('month')}
            >
              This month
            </button>
            <button
              type="button"
              className={`pill-btn ${scope === 'all' ? 'active' : ''}`}
              onClick={() => setScope('all')}
            >
              All time
            </button>
          </div>
        </label>

        {scope === 'month' && (
          <label className="form-field" style={{ marginTop: '14px' }}>
            Month
            <MonthSwitcher month={pickedMonth} onChange={setPickedMonth} />
          </label>
        )}

        {monthEmpty && (
          <span className="empty-text" role="status">
            No transactions in {monthLabel(pickedMonth)} — the exported sheet would be empty.
          </span>
        )}
        {allEmpty && (
          <span className="empty-text" role="status">
            No transaction history yet — the exported sheet would be empty.
          </span>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={handleExport} disabled={exportDisabled}>
            Export
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  )
}
