import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../contexts/auth.js'
import { LoginForm, SignupForm } from './AuthForms.jsx'

// Header's "Add account" — same modal/overlay/portal conventions as
// TransactionModal.jsx (.modal-overlay/.modal-panel/.modal-head/.modal-tabs,
// portal to #modal-root). There's no dedicated "add account" endpoint
// (contract F) — this is just login/signup for a not-yet-known session,
// which AuthContext.login/signup already promote to the active session
// (remounting the per-user CategoriesProvider/TransactionActivityProvider
// in App.jsx), so submitting here both adds AND switches to the new account.
export default function AddAccountModal({ onClose }) {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState('login')

  async function handleLogin(credentials) {
    await login(credentials)
    onClose()
  }

  async function handleSignup(credentials) {
    await signup(credentials)
    onClose()
  }

  const portalTarget = document.getElementById('modal-root') || document.body

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add account</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`pill-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            className={`pill-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        {mode === 'login' ? (
          <LoginForm key="login" onSubmit={handleLogin} submitLabel="Log in and switch" />
        ) : (
          <SignupForm key="signup" onSubmit={handleSignup} submitLabel="Create and switch" />
        )}
      </div>
    </div>,
    portalTarget
  )
}
