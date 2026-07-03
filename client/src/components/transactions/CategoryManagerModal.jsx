import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client.js'
import { useCategories } from '../../contexts/categories.js'
import { ACCOUNTS, ACCOUNT_NAMES } from '../../constants/categories.js'

const RESERVED_NAMES = ['transfer-in', 'transfer-out']

function CategoryColumn({ title, list, listKey, accountId, placeholder, refetch }) {
  const [draft, setDraft] = useState('')
  const [addError, setAddError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [rowErrors, setRowErrors] = useState({})
  const inputRef = useRef(null)

  function handleDraftChange(value) {
    setDraft(value)
    setAddError(null)
  }

  async function handleAdd() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setAddError('Enter a category name.')
      return
    }
    if (trimmed.length > 30) {
      setAddError('Category name must be 30 characters or fewer.')
      return
    }
    if (RESERVED_NAMES.includes(trimmed.toLowerCase())) {
      setAddError(`"${trimmed}" is reserved and can't be used as a category name.`)
      return
    }
    const isDuplicate = list.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
    if (isDuplicate) {
      setAddError(`category "${trimmed}" already exists in ${listKey}`)
      return
    }
    setSubmitting(true)
    try {
      await api.createCategory({ name: trimmed, list: listKey, account_id: accountId })
      setDraft('')
      setAddError(null)
      await refetch()
      inputRef.current?.focus()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(category) {
    setRemovingId(category.id)
    setRowErrors((prev) => ({ ...prev, [category.id]: null }))
    try {
      await api.deleteCategory(category.id)
      await refetch()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [category.id]: err.message }))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="category-manager-column">
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p className="empty-text">No {listKey} categories yet. Add one below.</p>
      ) : (
        <ul className="category-manager-list">
          {list.map((category) => {
            const isRemoving = removingId === category.id
            const rowError = rowErrors[category.id]
            return (
              <li key={category.id}>
                <div className="category-manager-row" style={{ opacity: isRemoving ? 0.6 : 1 }}>
                  <span className="cat-bar-row-label" style={{ textTransform: 'none' }}>
                    <span className="cat-bar-row-swatch" style={{ background: category.color }} aria-hidden="true" />
                    {category.name}
                  </span>
                  <button
                    type="button"
                    className="btn-sm btn-sm-delete"
                    aria-label={`Remove category ${category.name}`}
                    disabled={isRemoving}
                    onClick={() => handleRemove(category)}
                  >
                    Remove
                  </button>
                </div>
                {rowError && <div className="error-text" role="alert">{rowError}</div>}
              </li>
            )
          })}
        </ul>
      )}

      <div className="category-manager-add">
        <input
          ref={inputRef}
          type="text"
          maxLength={30}
          placeholder={placeholder}
          aria-label={placeholder}
          value={draft}
          disabled={submitting}
          style={{ opacity: submitting ? 0.6 : 1 }}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
        />
        <button type="button" className="btn-sm" disabled={submitting} onClick={handleAdd}>
          Add
        </button>
      </div>
      {addError && <div className="error-text" role="alert">{addError}</div>}
    </div>
  )
}

export default function CategoryManagerModal({ accountId, initialAccountId, onClose }) {
  // Two call modes, gated purely by whether the caller pins `accountId`:
  // - Fixed mode (TransactionModal): `accountId` is provided → single account,
  //   no selector, behavior unchanged from before this feature.
  // - Standalone/selectable mode (Transactions/Budget page buttons): `accountId`
  //   is omitted, `initialAccountId` seeds the initial selection, and an
  //   account selector renders so the user can switch which account's
  //   categories they're managing.
  const selectable = accountId === undefined
  const [selectedAccountId, setSelectedAccountId] = useState(
    accountId ?? initialAccountId ?? ACCOUNTS.SPENDING
  )
  const activeAccountId = selectable ? selectedAccountId : accountId
  const { outgoingFor, incomingFor, loading, error, refetch } = useCategories()
  const panelRef = useRef(null)

  useEffect(() => {
    const firstInput = panelRef.current?.querySelector('input')
    firstInput?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusables = panel.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  // Defense-in-depth: never render system categories even if a future API
  // regression slips them through (per AC3's "excluded entirely" wording).
  const outgoingList = outgoingFor(activeAccountId).filter((c) => !RESERVED_NAMES.includes(c.name.toLowerCase()))
  const incomingList = incomingFor(activeAccountId).filter((c) => !RESERVED_NAMES.includes(c.name.toLowerCase()))

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 51 }} onClick={onClose}>
      <div className="modal-panel" style={{ width: 'min(620px, 100%)' }} onClick={(e) => e.stopPropagation()} ref={panelRef}>
        <div className="modal-head">
          <h2>Manage categories — {ACCOUNT_NAMES[activeAccountId]}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {selectable && (
          <div className="pill-group" style={{ marginBottom: '16px' }}>
            {Object.entries(ACCOUNT_NAMES).map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={`pill-btn ${String(activeAccountId) === id ? 'active' : ''}`}
                onClick={() => setSelectedAccountId(Number(id))}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="loading-placeholder"><p>Loading...</p></div>
        ) : error ? (
          <div style={{ textAlign: 'center' }}>
            <p className="error-text" role="alert">Couldn't load categories. Try again.</p>
            <button type="button" className="btn-secondary" onClick={refetch}>Retry</button>
          </div>
        ) : (
          <div className="modal-form-grid">
            <CategoryColumn
              title="Outgoing"
              list={outgoingList}
              listKey="outgoing"
              accountId={activeAccountId}
              placeholder="Add outgoing category"
              refetch={refetch}
            />
            <CategoryColumn
              title="Incoming"
              list={incomingList}
              listKey="incoming"
              accountId={activeAccountId}
              placeholder="Add incoming category"
              refetch={refetch}
            />
          </div>
        )}
      </div>
    </div>,
    document.getElementById('modal-root') || document.body
  )
}
