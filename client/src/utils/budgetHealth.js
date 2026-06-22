// Shared presentational helpers for budget-health classification
// ('under' / 'near' / 'over'), used by both the Budget page's editing list
// and the Overview Budget card's comparison list so the two stay visually
// consistent.

export function fillColorFor(health) {
  if (health === 'over') return 'var(--red)'
  if (health === 'near') return 'var(--warning)'
  return 'var(--green)' // under
}

// Non-color text cue for near/over, matching the highlight.js convention of
// not relying on color alone.
export function suffixFor(health) {
  if (health === 'over') return { text: ' — over', color: 'var(--red)' }
  if (health === 'near') return { text: ' — near limit', color: 'var(--warning-text)' }
  return null
}
