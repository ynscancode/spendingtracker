import { useRef } from 'react'

const VIEWS = [['combined', 'Combined'], ['spending', 'Spending'], ['savings', 'Savings']]

// Segmented radiogroup (Combined | Spending | Savings). Roving tabindex:
// only the checked radio is in the tab order; Arrow keys move + select,
// Home/End jump to the ends. Reuses the .pill-group/.pill-btn look.
export default function BreakdownViewSwitch({ view, onViewChange }) {
  const refs = useRef([])

  function handleKeyDown(e, index) {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % VIEWS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + VIEWS.length) % VIEWS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = VIEWS.length - 1
    if (next === null) return
    e.preventDefault()
    onViewChange(VIEWS[next][0])
    refs.current[next]?.focus()
  }

  return (
    <div className="pill-group" role="radiogroup" aria-label="Breakdown view">
      {VIEWS.map(([key, label], i) => {
        const checked = view === key
        return (
          <button
            key={key}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`pill-btn ${checked ? 'active' : ''}`}
            onClick={() => onViewChange(key)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
