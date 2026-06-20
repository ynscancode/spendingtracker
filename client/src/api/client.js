async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
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

  getDailySummary: (date) => request('GET', `/summary/daily?date=${date}`),
  getMonthlySummary: (month) => request('GET', `/summary/monthly?month=${month}`),

  getBudgets: (month) => request('GET', `/budgets?month=${month}`),
  setBudget: ({ month, category, amount }) => request('PUT', '/budgets', { month, category, amount }),
  clearBudget: ({ month, category }) => request('DELETE', `/budgets?month=${month}&category=${category}`),

  getCategories: () => request('GET', '/categories'),
  createCategory: ({ name, list }) => request('POST', '/categories', { name, list }),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),
};
