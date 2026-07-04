import { useEffect, useRef, useState } from 'react'
import { User, ChevronDown, RefreshCw, Plus, LogOut } from 'lucide-react'
import { useAuth } from '../../contexts/auth.js'
import AddAccountModal from '../auth/AddAccountModal.jsx'

// Header's account switcher (contract G / BATCH 11): current username +
// dropdown of other known sessions (`ledger.authSessions`), "Add account",
// "Log out". Closes on outside-click/Escape, same conventions as other
// dropdown-ish controls in the app (MonthSwitcher, pill-groups) reusing
// index.css tokens rather than a new palette.
export default function AccountSwitcher() {
  const { user, sessions, switchAccount, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [switchError, setSwitchError] = useState(null)
  const [switching, setSwitching] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!user) return null

  const otherUsernames = Object.keys(sessions).filter((name) => name !== user.username)

  async function handleSwitch(username) {
    setSwitchError(null)
    setSwitching(true)
    try {
      await switchAccount(username)
      setOpen(false)
    } catch (err) {
      setSwitchError(err.message)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="account-switcher" ref={rootRef}>
      <button
        type="button"
        className="account-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <User size={15} aria-hidden="true" />
        <span className="account-switcher-name">{user.username}</span>
        {user.isGuest && <span className="account-switcher-badge">Guest</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="account-switcher-menu" role="menu">
          {otherUsernames.length > 0 && (
            <div className="account-switcher-group">
              <span className="account-switcher-group-label">Switch account</span>
              {otherUsernames.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className="account-switcher-item"
                  onClick={() => handleSwitch(name)}
                  disabled={switching}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  {name}
                </button>
              ))}
            </div>
          )}
          {switchError && <span className="error-text account-switcher-error" role="alert">{switchError}</span>}
          <button
            type="button"
            role="menuitem"
            className="account-switcher-item"
            onClick={() => { setAddOpen(true); setOpen(false) }}
          >
            <Plus size={13} aria-hidden="true" />
            Add account
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-switcher-item account-switcher-item-danger"
            onClick={() => { setOpen(false); logout() }}
          >
            <LogOut size={13} aria-hidden="true" />
            Log out
          </button>
        </div>
      )}

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
    </div>
  )
}
