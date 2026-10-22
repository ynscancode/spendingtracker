import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { User, ChevronDown, Plus, LogOut, Trash2, Check } from 'lucide-react'
import { useAuth } from '../../contexts/auth.js'
import { getModalRoot } from '../../utils/modalRoot.js'
import AddAccountModal from '../auth/AddAccountModal.jsx'
import DeleteAccountModal from '../auth/DeleteAccountModal.jsx'
import StyleSwitcher from './StyleSwitcher.jsx'

// Header's account switcher (contract G / BATCH 11): current username +
// the other known sessions (`ledger.authSessions`), "Add account", "Log out",
// "Delete account". Above 760px it is a dropdown menu anchored to the sky
// account pill; at <=760px the same open state and handlers drive a bottom
// sheet (reusing the .modal-overlay/.modal-panel sheet look) opened from the
// round account button, which also holds the Style switcher. Closes on
// Escape (and outside-click on desktop / scrim-click on phones) and returns
// focus to whichever button opened it.
const PHONE_QUERY = '(max-width: 760px)'

function subscribePhone(callback) {
  const mql = window.matchMedia(PHONE_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function usePhoneLayout() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

export default function AccountSwitcher() {
  const { user, sessions, switchAccount, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [switchError, setSwitchError] = useState(null)
  const [switching, setSwitching] = useState(false)
  const isPhone = usePhoneLayout()
  const rootRef = useRef(null)
  const desktopTriggerRef = useRef(null)
  const phoneTriggerRef = useRef(null)
  const panelRef = useRef(null)
  const closeBtnRef = useRef(null)

  function closeAndRestoreFocus() {
    setOpen(false)
    const trigger = isPhone ? phoneTriggerRef.current : desktopTriggerRef.current
    if (trigger) trigger.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(e) {
      // Phone sheet is portaled and dismissed by its scrim, not by this check.
      if (!isPhone && rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        const trigger = isPhone ? phoneTriggerRef.current : desktopTriggerRef.current
        if (trigger) trigger.focus()
        return
      }
      // Sheet is aria-modal: keep Tab inside it.
      if (isPhone && e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll('button:not([disabled])')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, isPhone])

  // Move focus into the sheet when it opens.
  useEffect(() => {
    if (open && isPhone && closeBtnRef.current) closeBtnRef.current.focus()
  }, [open, isPhone])

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

  // Same rows/handlers for the desktop menu (role=menu/menuitem) and the phone
  // sheet (plain buttons inside a dialog, where menuitem would be invalid).
  function renderItems(asMenu) {
    const itemRole = asMenu ? 'menuitem' : undefined
    return (
      <>
        <div className="account-switcher-group">
          {otherUsernames.length > 0 && (
            <span className="account-switcher-group-label">Switch account</span>
          )}
          <div
            className="account-switcher-item account-switcher-item-current"
            role={itemRole}
            aria-disabled={asMenu ? 'true' : undefined}
            aria-current="true"
          >
            <span className="account-switcher-av" aria-hidden="true">{user.username.charAt(0).toUpperCase()}</span>
            <span className="account-switcher-item-label">{user.username}</span>
            {user.isGuest && <span className="account-switcher-badge">Guest</span>}
            <Check size={15} aria-hidden="true" />
          </div>
          {otherUsernames.map((name) => (
            <button
              key={name}
              type="button"
              role={itemRole}
              className="account-switcher-item"
              onClick={() => handleSwitch(name)}
              disabled={switching}
            >
              <span className="account-switcher-av" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
              <span className="account-switcher-item-label">{name}</span>
            </button>
          ))}
        </div>
        {switchError && <span className="error-text account-switcher-error" role="alert">{switchError}</span>}
        <div className="account-switcher-rule" aria-hidden="true" />
        <button
          type="button"
          role={itemRole}
          className="account-switcher-item"
          onClick={() => { setAddOpen(true); setOpen(false) }}
        >
          <Plus size={16} aria-hidden="true" />
          Add account
        </button>
        <button
          type="button"
          role={itemRole}
          className="account-switcher-item"
          onClick={() => { setOpen(false); logout() }}
        >
          <LogOut size={16} aria-hidden="true" />
          Log out
        </button>
        <button
          type="button"
          role={itemRole}
          className="account-switcher-item account-switcher-item-danger"
          onClick={() => { setOpen(false); setDeleteOpen(true) }}
        >
          <Trash2 size={16} aria-hidden="true" />
          Delete account
        </button>
      </>
    )
  }

  return (
    <div className="account-switcher" ref={rootRef}>
      {/* Desktop trigger: sky pill. Hidden by CSS at <=760px. */}
      <button
        type="button"
        ref={desktopTriggerRef}
        className="account-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open && !isPhone}
      >
        <span className="account-switcher-name">{user.username}</span>
        {user.isGuest && <span className="account-switcher-badge">Guest</span>}
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {/* Phone trigger: round sky button (44px). Hidden by CSS above 760px. */}
      <button
        type="button"
        ref={phoneTriggerRef}
        className="account-switcher-round"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open && isPhone}
        aria-label={`Account and style (${user.username})`}
      >
        <User size={20} aria-hidden="true" />
      </button>

      {open && !isPhone && (
        <div className="account-switcher-menu" role="menu">
          {renderItems(true)}
        </div>
      )}

      {open && isPhone && createPortal(
        <div className="modal-overlay" onClick={closeAndRestoreFocus}>
          <div
            className="modal-panel account-sheet"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Account and style"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Account</h2>
              <button
                type="button"
                ref={closeBtnRef}
                className="modal-close"
                onClick={closeAndRestoreFocus}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="account-sheet-style">
              <span className="account-sheet-caption">Style</span>
              <StyleSwitcher className="account-sheet-switcher" />
            </div>
            <div className="account-sheet-list">
              {renderItems(false)}
            </div>
          </div>
        </div>,
        getModalRoot(),
      )}

      {addOpen && <AddAccountModal onClose={() => setAddOpen(false)} />}
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} />}
    </div>
  )
}
