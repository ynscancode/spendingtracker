import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCategories } from '../../contexts/categories.js'
import { useCategoryColor } from '../../hooks/useCategoryColor.js'
import { NEUTRAL_COLOR } from '../../utils/categoryColor.js'
import { getModalRoot } from '../../utils/modalRoot.js'
import { buildGroups, scopedKeys, TRANSFER_KEY } from './categoryFilter.js'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])'

// Trigger + Reset + the filter dialog. The hidden-keys Set lives in
// TransactionsPage (it must survive month/account changes and drive the list);
// only `open` is local. `triggerRef` is owned by the page so it can also return
// focus here after "Show all categories" in the filtered-empty state.
export default function CategoryFilter({ transactions, scope, hiddenKeys, onChange, triggerRef }) {
  const { outgoingFor, incomingFor } = useCategories()
  const [open, setOpen] = useState(false)

  const groups = useMemo(
    () => buildGroups({ outgoingFor, incomingFor, transactions, scope }),
    [outgoingFor, incomingFor, transactions, scope],
  )
  const keys = useMemo(() => scopedKeys(groups), [groups])
  const hiddenCount = keys.filter((k) => hiddenKeys.has(k)).length
  const active = hiddenCount > 0
  const shown = keys.length - hiddenCount

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function reset() {
    onChange(new Set())
    // Reset unmounts once the filter is inactive; keep focus somewhere real.
    triggerRef.current?.focus()
  }

  return (
    <div className="filter-strip-cats">
      <span className="filter-strip-label">Category</span>
      <button
        ref={triggerRef}
        type="button"
        className={`btn-ghost cat-filter-trigger${active ? ' is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="cat-filter-dialog"
        aria-label={active ? `Filter by category. ${shown} of ${keys.length} shown` : undefined}
        onClick={() => setOpen(true)}
      >
        Categories
        {active && <span className="cat-filter-count">{shown} of {keys.length}</span>}
      </button>
      {active && (
        <button type="button" className="btn-ghost cat-filter-reset" aria-label="Reset category filter" onClick={reset}>
          Reset
        </button>
      )}
      {open && (
        <CategoryFilterDialog
          groups={groups}
          keys={keys}
          hiddenKeys={hiddenKeys}
          shown={shown}
          onChange={onChange}
          onClose={close}
        />
      )}
    </div>
  )
}

function CategoryFilterDialog({ groups, keys, hiddenKeys, shown, onChange, onClose }) {
  const colorFor = useCategoryColor()
  const panelRef = useRef(null)

  // Focus the first checkbox on open.
  useEffect(() => {
    panelRef.current?.querySelector('input[type="checkbox"]')?.focus()
  }, [])

  function toggle(key) {
    const next = new Set(hiddenKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  // Other-account keys already in the set are retained.
  function showAll() {
    const next = new Set(hiddenKeys)
    for (const k of keys) next.delete(k)
    onChange(next)
  }

  function hideAll() {
    onChange(new Set([...hiddenKeys, ...keys]))
  }

  // Bound to the dialog subtree only, so it never reacts while closed. The
  // dialog is not a React descendant of an inline EditRow, so its Escape can't
  // reach that row's handler; stopPropagation is belt-and-braces.
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = panelRef.current.querySelectorAll(FOCUSABLE)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const activeEl = document.activeElement
    if (e.shiftKey && (activeEl === first || !panelRef.current.contains(activeEl))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (activeEl === last || !panelRef.current.contains(activeEl))) {
      e.preventDefault()
      first.focus()
    }
  }

  const row = (key, label, swatch) => (
    <label className="cat-row" key={key}>
      <input type="checkbox" className="cat-check" checked={!hiddenKeys.has(key)} onChange={() => toggle(key)} />
      {swatch}
      <span className="cat-name">{label}</span>
    </label>
  )

  return createPortal(
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        className="modal-panel cat-filter-panel"
        id="cat-filter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-filter-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="cat-filter-title">Filter by category</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="cat-filter-tools">
          <span className="cat-filter-summary" role="status" aria-live="polite">
            {shown} of {keys.length} shown
          </span>
          <button type="button" className="btn-ghost cat-filter-bulk" onClick={showAll}>Show all</button>
          <button type="button" className="btn-ghost cat-filter-bulk" onClick={hideAll}>Hide all</button>
        </div>
        <div className="cat-filter-body">
          {groups.map((g) => (
            <fieldset className="cat-group" key={g.accountId}>
              <legend>{g.name}</legend>
              {g.directions.map((d) => {
                const headId = `cg-${g.accountId}-${d.direction}`
                return (
                  <div role="group" aria-labelledby={headId} className="cat-subgroup" key={d.direction}>
                    <div className="cat-subhead" id={headId}>{d.label}</div>
                    {d.items.map((item) => row(
                      item.key,
                      item.label,
                      <span
                        className="cat-swatch"
                        style={{ background: colorFor(g.accountId, item.name, d.direction) || NEUTRAL_COLOR }}
                        aria-hidden="true"
                      />,
                    ))}
                  </div>
                )
              })}
            </fieldset>
          ))}
          <fieldset className="cat-group">
            <legend>Transfers</legend>
            {row(
              TRANSFER_KEY,
              'Transfers between accounts',
              <span className="cat-swatch cat-swatch-transfer" aria-hidden="true" />,
            )}
          </fieldset>
        </div>
        <div className="cat-filter-foot">
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    getModalRoot(),
  )
}
