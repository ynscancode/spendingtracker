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
