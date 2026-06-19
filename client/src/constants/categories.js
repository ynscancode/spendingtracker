export const OUTGOING_CATEGORIES = [
  'food', 'drinks', 'transport', 'shopping', 'alcohol', 'fun', 'bills', 'travel', 'transfer-out'
];

export const INCOMING_CATEGORIES = [
  'income', 'transfer-in', 'other'
];

// Categories only ever set by the transfer flow, never picked manually.
export const TRANSFER_CATEGORIES = ['transfer-in', 'transfer-out'];

export const ACCOUNTS = {
  SPENDING: 1,
  SAVINGS: 2,
};

// Outgoing categories a user can actually set a monthly budget for —
// transfer-out is system-managed, never budgetable.
export const BUDGETABLE_CATEGORIES = OUTGOING_CATEGORIES.filter((c) => c !== 'transfer-out');

export const ACCOUNT_NAMES = {
  1: 'Spending',
  2: 'Savings',
};

// Category color palette — cycles through outgoing categories then incoming,
// matching the design spec's PALETTE order.
const PALETTE = ['#CC785C', '#4FB3A7', '#D4A24E', '#7C8CDE', '#C06A9E', '#5FA85A', '#B4754A', '#8A8F98'];

const ORDERED_CATEGORIES_FOR_COLOR = [
  'food', 'drinks', 'transport', 'shopping', 'alcohol', 'fun', 'bills', 'travel',
  'income', 'other',
];

const COLOR_BY_CATEGORY = {};
ORDERED_CATEGORIES_FOR_COLOR.forEach((cat, i) => {
  COLOR_BY_CATEGORY[cat] = PALETTE[i % PALETTE.length];
});

export function colorForCategory(category) {
  return COLOR_BY_CATEGORY[category] || '#8A8F98';
}
