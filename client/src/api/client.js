// Base URL for the backend API. Empty string in local dev (unset
// VITE_API_URL) means requests stay relative (`/api/...`) and go through
// vite.config.js's dev-server proxy to http://localhost:4000, unchanged from
// before. In production, set VITE_API_URL to the deployed backend's absolute
// origin (e.g. https://your-app.fly.dev) at build time, since a static
// SPA host (Vercel/Netlify) has no server-side proxy to forward /api to.
export const API_BASE = import.meta.env.VITE_API_URL || '';
export const API_TOKEN = import.meta.env.VITE_API_TOKEN || '';

// BATCH 11 (user auth): the active user's JWT lives in localStorage, not a
// module-level variable — read fresh on every request (mirrors the server's
// `readConfig()` pattern) so switching accounts via AuthContext takes effect
// on the very next call with no reload needed. Key name matches the
// tech-lead contract (`ledger.authToken`) exactly, since AuthContext reads/
// writes the same key directly for the initial session-check-on-load.
const AUTH_TOKEN_KEY = 'ledger.authToken';

// "Stay signed in" (login-stage only, see AuthForms.jsx's LoginForm): when
// checked (default, preserves pre-existing behavior) the token lives in
// localStorage and survives a browser close; when unchecked it lives in
// sessionStorage instead, so it's gone once the browser/tab session ends.
// There must be exactly one active token at a time, so every write to one
// storage removes the key from the other.
export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token, { persist = true } = {}) {
  try {
    if (!token) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
      return;
    }
    if (persist) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
    } else {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // localStorage/sessionStorage unavailable (e.g. private mode) — session
    // just won't persist across a reload; matches ThemeProvider's non-fatal
    // handling.
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

// Exported so any caller that needs to build a raw request URL outside this
// module's request()/requestFormData() wrappers (currently: ExportModal.jsx's
// direct anchor-navigation download, which can't go through fetch()) uses the
// exact same base — there must be only one place that decides the API origin.
export function apiUrl(path) {
  return `${API_BASE}/api${path}`;
}

// BATCH 11 — two orthogonal gates, one header each (tech-lead contract A/G):
// the static API_TOKEN moved OFF `Authorization` onto `X-API-Token`, freeing
// `Authorization: Bearer <jwt>` for the per-user session token. Both are sent
// whenever present; neither implies the other.
function authHeader() {
  const headers = {};
  if (API_TOKEN) headers['X-API-Token'] = API_TOKEN;
  const authToken = getAuthToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

// Any 401 (other than from the auth endpoints themselves, whose 401s are
// ordinary form-validation results a caller handles inline — see
// AuthForms.jsx) means the active session is dead (expired/rotated secret/
// revoked). Broadcasting it lets AuthContext react from anywhere in the
// app — not just from calls it made directly — and drop back to the auth
// screen, per contract G ("On any 401: clear ledger.authToken and drop to
// the auth screen").
function reportIfUnauthorized(status, path) {
  if (status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('ledger:unauthorized'));
  }
}

async function request(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    reportIfUnauthorized(res.status, path);
    const err = new Error(data?.error || `${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getAccounts: () => request('GET', '/accounts'),

  getTransactions: ({ from, to, accountId } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (accountId) params.set('account_id', accountId);
    const qs = params.toString();
    return request('GET', `/transactions${qs ? `?${qs}` : ''}`);
  },

  createTransaction: (data) => request('POST', '/transactions', data),
  createTransfer: (data) => request('POST', '/transactions/transfer', data),
  updateTransaction: (id, data) => request('PUT', `/transactions/${id}`, data),
  deleteTransaction: (id) => request('DELETE', `/transactions/${id}`),
  deleteAllTransactions: () => request('DELETE', '/transactions/all'),

  getDailySummary: (date) => request('GET', `/summary/daily?date=${date}`),
  getMonthlySummary: (month) => request('GET', `/summary/monthly?month=${month}`),
  getTransactionActivity: () => request('GET', '/summary/activity'),

  getBudgets: (month) => request('GET', `/budgets?month=${month}`),
  setBudget: ({ month, category, amount }) => request('PUT', '/budgets', { month, category, amount }),
  getRecentBudgetMonth: (month) => request('GET', `/budgets/recent?month=${month}`),
  copyBudgetsFromRecent: (month) => request('POST', '/budgets/copy-from-recent', { month }),
  clearBudgets: (month) => request('POST', '/budgets/clear', { month }),

  getCategories: (accountId) => request('GET', `/categories?account_id=${accountId}`),
  createCategory: ({ name, list, account_id }) => request('POST', '/categories', { name, list, account_id }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  // BATCH 11 — /api/auth/* (routes/auth.js). signup/login/guest/logout are
  // JWT-exempt (reachable with only the static token, per contract A); `me`
  // requires a valid Authorization: Bearer <jwt> and is used for the
  // session-check-on-load in AuthContext.
  signup: ({ username, password }) => request('POST', '/auth/signup', { username, password }),
  login: ({ username, password }) => request('POST', '/auth/login', { username, password }),
  guest: () => request('POST', '/auth/guest', {}),
  me: () => request('GET', '/auth/me'),
  logout: () => request('POST', '/auth/logout', {}),
  // Delete-account (senior-backend-dev contract, TEAM-BOARD.md "delete
  // account" note): body's `password` is required for a real account,
  // ignored server-side for a guest (guests have no password_hash to
  // verify). A wrong-password 401 comes back from `/auth/me`, which
  // reportIfUnauthorized() already excludes from the global
  // ledger:unauthorized broadcast (path.startsWith('/auth/')) — so it stays
  // an inline, catchable form error here rather than dropping the CURRENT
  // (still-valid) session to the auth screen.
  deleteAccount: ({ password } = {}) => request('DELETE', '/auth/me', { password }),
};
