import { useState } from 'react'

// Shared, presentational login/signup forms — used both full-page
// (AuthScreen.jsx, no session yet) and inside a modal (AddAccountModal.jsx,
// already logged in). Each takes an `onSubmit(credentials)` that performs
// the actual API call + session update (AuthContext's login/signup); this
// component only owns its own field state, client-side validation, and the
// inline `role="alert"` error convention TransactionModal.jsx already uses.

export function LoginForm({ onSubmit, submitLabel = 'Log in' }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Username and password are required')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ username: username.trim(), password })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="form-field">
        Username
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="form-field">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <span className="error-text" role="alert">{error}</span>}
      <button type="submit" className="btn auth-submit" disabled={submitting}>
        {submitting ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}

export function SignupForm({ onSubmit, submitLabel = 'Sign up' }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Username and password are required')
      return
    }
    // Mirrors the server's MIN_PASSWORD_LENGTH (authService.js) so the
    // common case surfaces as instant client-side feedback — the server
    // call remains the authoritative check either way.
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ username: username.trim(), password })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="form-field">
        Username
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="form-field">
        Password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="form-field">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <span className="error-text" role="alert">{error}</span>}
      <button type="submit" className="btn auth-submit" disabled={submitting}>
        {submitting ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}
