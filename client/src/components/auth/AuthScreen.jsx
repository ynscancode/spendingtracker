import { useState } from 'react'
import { useAuth } from '../../contexts/auth.js'
import { LoginForm, SignupForm } from './AuthForms.jsx'

// Rendered by App.jsx in place of the whole app when there's no active
// session (contract G). Not a modal/overlay — no portal, it IS the page —
// so it reuses `.modal-tabs`/`.pill-btn`/`.form-field`/`.error-text`/`.btn`
// tokens from index.css for visual consistency without inventing new ones,
// inside its own `.auth-screen`/`.auth-card` layout wrapper.
export default function AuthScreen() {
  const { login, signup, guest } = useAuth()
  const [mode, setMode] = useState('login')
  const [guestError, setGuestError] = useState(null)
  const [guestSubmitting, setGuestSubmitting] = useState(false)

  async function handleGuest() {
    setGuestError(null)
    setGuestSubmitting(true)
    try {
      await guest()
    } catch (err) {
      setGuestError(err.message)
    } finally {
      setGuestSubmitting(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Ledger</span>
        </div>
        <p className="auth-tagline">Track spending and savings, privately, in one place.</p>

        <div className="modal-tabs auth-tabs">
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
          <LoginForm key="login" onSubmit={login} submitLabel="Log in" />
        ) : (
          <SignupForm key="signup" onSubmit={signup} submitLabel="Create account" />
        )}

        <div className="auth-divider" role="presentation">
          <span>or</span>
        </div>

        <button
          type="button"
          className="btn-secondary auth-guest-btn"
          onClick={handleGuest}
          disabled={guestSubmitting}
        >
          {guestSubmitting ? 'Creating guest session…' : 'Use as guest'}
        </button>
        <p className="auth-guest-note">
          Guest data is isolated to this browser and can&rsquo;t be logged back into later — there&rsquo;s
          no username or password to recover it with, so it&rsquo;s reachable only until this
          browser&rsquo;s storage is cleared. Sign up instead if you want to come back to your data
          later or from another device.
        </p>
        {guestError && <span className="error-text" role="alert">{guestError}</span>}
      </div>
    </div>
  )
}
