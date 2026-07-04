import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../api/client.js'
import { AuthContext } from './auth.js'

// `ledger.authSessions` — JSON { [username]: token } map of every session
// this browser knows about (tech-lead contract G). Kept alongside the single
// active `ledger.authToken` (read/written by api/client.js directly) so the
// Header account switcher can promote a known session without re-login.
const SESSIONS_KEY = 'ledger.authSessions'

function readSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch {
    // localStorage unavailable — sessions just won't persist across reload.
  }
}

// Session/account-switching for BATCH 11 (user auth). Mirrors
// CategoriesProvider/TransactionActivityProvider's refetch-on-mount shape,
// but the "fetch" here is a one-time session-check-on-load against
// GET /api/auth/me rather than a per-user data load (that part is
// CategoriesProvider/TransactionActivityProvider's job, keyed by user.id in
// App.jsx so they remount on account switch).
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState(readSessions)

  const rememberSession = useCallback((username, token) => {
    setSessions((prev) => {
      const next = { ...prev, [username]: token }
      writeSessions(next)
      return next
    })
  }, [])

  const forgetSession = useCallback((username) => {
    setSessions((prev) => {
      if (!username || !(username in prev)) return prev
      const next = { ...prev }
      delete next[username]
      writeSessions(next)
      return next
    })
  }, [])

  // Session-check-on-load (contract G): read the stored active token; if
  // present, verify it against GET /api/auth/me. 200 -> set user; missing ->
  // straight to the auth screen; 401/error -> clear the dead token first.
  useEffect(() => {
    let cancelled = false
    async function checkSession() {
      const token = getAuthToken()
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const data = await api.me()
        if (!cancelled) setUser(data.user)
      } catch {
        if (!cancelled) clearAuthToken()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    checkSession()
    return () => { cancelled = true }
  }, [])

  // Any 401 from anywhere else in the app (not just calls this provider made
  // directly) means the active session died server-side — react the same
  // way the initial check's failure branch does: drop the token, drop the
  // user, App.jsx's !user branch renders <AuthScreen> on the next render.
  useEffect(() => {
    function handleUnauthorized() {
      clearAuthToken()
      setUser(null)
    }
    window.addEventListener('ledger:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('ledger:unauthorized', handleUnauthorized)
  }, [])

  const applySession = useCallback((token, sessionUser) => {
    setAuthToken(token)
    rememberSession(sessionUser.username, token)
    setUser(sessionUser)
  }, [rememberSession])

  const login = useCallback(async ({ username, password }) => {
    const data = await api.login({ username, password })
    applySession(data.token, data.user)
    return data.user
  }, [applySession])

  const signup = useCallback(async ({ username, password }) => {
    const data = await api.signup({ username, password })
    applySession(data.token, data.user)
    return data.user
  }, [applySession])

  const guest = useCallback(async () => {
    const data = await api.guest()
    applySession(data.token, data.user)
    return data.user
  }, [applySession])

  // Logout is client-side token discard (contract B) — the server call is a
  // stateless no-op best-effort ping, not load-bearing for correctness.
  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Non-fatal — logging out must succeed locally even if the network
      // call fails; the token discard below is what actually ends the
      // session from the client's point of view.
    }
    setUser((current) => {
      if (current) forgetSession(current.username)
      return null
    })
    clearAuthToken()
  }, [forgetSession])

  // Promote a different already-known session to active without a full
  // re-login (Header's "switch account"), re-verifying it via GET
  // /api/auth/me since a stored token can go stale (e.g. JWT_SECRET
  // rotated). An invalid stored token is dropped from `sessions` so it
  // stops showing up as switchable.
  const switchAccount = useCallback(async (username) => {
    const token = sessions[username]
    if (!token) throw new Error(`No saved session for ${username}`)
    setAuthToken(token)
    try {
      const data = await api.me()
      setUser(data.user)
      return data.user
    } catch (err) {
      clearAuthToken()
      forgetSession(username)
      throw err
    }
  }, [sessions, forgetSession])

  // No dedicated "add account" endpoint (contract F) — it's login/signup for
  // an account not yet in `sessions`, which becomes the new active session
  // via applySession exactly like a fresh login/signup would. Named
  // separately from login/signup only so the Header/AddAccountModal call
  // site reads intention-revealing.
  const addAccount = useCallback((mode, credentials) => (
    mode === 'signup' ? signup(credentials) : login(credentials)
  ), [signup, login])

  const value = useMemo(() => ({
    user,
    token: getAuthToken(),
    loading,
    sessions,
    login,
    signup,
    guest,
    logout,
    switchAccount,
    addAccount,
  }), [user, loading, sessions, login, signup, guest, logout, switchAccount, addAccount])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
