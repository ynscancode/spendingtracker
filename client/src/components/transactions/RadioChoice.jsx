import { useRef } from 'react'

// Presentational single-choice control used by TransactionModal for Direction,
// Account (segmented) and Category (chip row) in place of <select>s. It owns no
// state: `value` is the caller's current value and `onChange(option.value)` is
// the caller's existing handler, called with exactly the option's `value` as
// given (so a string stays a string).
//
// Semantics: role="radiogroup" labelled by the caller's visible label text
// (`labelledBy` = that element's id) with role="radio" + aria-checked children.
// Roving tabindex (only the checked radio is a tab stop; if no option matches
// `value` the first one is, so the group is never unreachable). Arrow keys move
// AND select, Home/End jump to the ends, same as BreakdownViewSwitch.
// Re-choosing the already-selected option is a no-op, like a <select> whose
// value did not change (the handlers reset the category, so this matters).
export default function RadioChoice({ options, value, onChange, labelledBy, groupClassName, itemClassName }) {
  const refs = useRef([])
  const checkedIndex = options.findIndex((o) => o.value === value)
  const tabbableIndex = checkedIndex >= 0 ? checkedIndex : 0

  function choose(option) {
    if (option.value !== value) onChange(option.value)
  }

  function handleKeyDown(e, index) {
    const last = options.length - 1
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    choose(options[next])
    refs.current[next]?.focus()
  }

  return (
    <div className={groupClassName} role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option, i) => {
        const checked = i === checkedIndex
        return (
          <button
            key={option.key ?? String(option.value)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === tabbableIndex ? 0 : -1}
            className={itemClassName}
            style={option.style}
            onClick={() => choose(option)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
