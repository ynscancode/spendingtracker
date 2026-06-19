// Returns a CSS class name (or null) describing how a transaction row should be highlighted.
// Transfer legs all get the same neutral row treatment (direction is conveyed by the
// IN/OUT badge instead, see transferBadgeFor); only non-transfer spend amounts use this
// for the >$20/>$40 warning-dot indicator.
export function highlightClassFor(txn) {
  if (txn.is_transfer) {
    return 'highlight-transfer'
  }

  if (txn.direction === 'out') {
    if (txn.amount > 40) return 'highlight-red'
    if (txn.amount > 20) return 'highlight-orange'
  }

  return null
}

// Returns a small IN/OUT text badge for a transfer leg, colored green/red by direction
// (matches the mockup's t.transferLabel / t.labelColor). Non-color text cue for WCAG 1.4.1.
export function transferBadgeFor(txn) {
  if (!txn.is_transfer) return null
  return {
    text: txn.direction === 'in' ? 'IN' : 'OUT',
    color: txn.direction === 'in' ? 'var(--green)' : 'var(--red)',
  }
}
