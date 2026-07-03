// Base URL for the backend API. Empty string in local dev (unset
// VITE_API_URL) means requests stay relative (`/api/...`) and go through
// vite.config.js's dev-server proxy to http://localhost:4000, unchanged from
// before. In production, set VITE_API_URL to the deployed backend's absolute
// origin (e.g. https://your-app.fly.dev) at build time, since a static
// SPA host (Vercel/Netlify) has no server-side proxy to forward /api to.
export const API_BASE = import.meta.env.VITE_API_URL || '';

// Exported so any caller that needs to build a raw request URL outside this
// module's request()/requestFormData() wrappers (currently: ExportModal.jsx's
// direct anchor-navigation download, which can't go through fetch()) uses the
// exact same base — there must be only one place that decides the API origin.
export function apiUrl(path) {
  return `${API_BASE}/api${path}`;
}

async function request(method, path, body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `${method} ${path} failed with ${res.status}`);
  }
  return data;
}

// Separate from request() on purpose: multipart bodies must NOT set a
// Content-Type header (the browser generates the multipart boundary itself),
// so this can't share request()'s JSON-only contract without overloading it
// with conditionals.
async function requestFormData(method, path, formData) {
  const res = await fetch(apiUrl(path), { method, body: formData });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `${method} ${path} failed with ${res.status}`);
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

  getCategories: (accountId) => request('GET', `/categories?account_id=${accountId}`),
  createCategory: ({ name, list, account_id }) => request('POST', '/categories', { name, list, account_id }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  parseImportFile: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return requestFormData('POST', '/imports/parse', fd);
  },
  commitImport: (payload) => request('POST', '/imports/commit', payload),
  suggestImportMapping: (payload) => request('POST', '/imports/suggest', payload),
};
