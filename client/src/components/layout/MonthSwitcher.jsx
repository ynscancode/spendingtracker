import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthLabel, prevMonthStr, nextMonthStr } from '../../utils/dateUtils.js'

// Reusable prev/next month stepper. Unlike BreakdownPage's <select> (which is
// constrained to months with real transaction history), this lets the caller
// navigate to any month — used by BudgetPage where every month is editable.
export default function MonthSwitcher({ month, onChange }) {
  return (
    <div className="month-switcher">
      <button
        type="button"
        className="month-switcher-btn"
        aria-label="Previous month"
        onClick={() => onChange(prevMonthStr(month))}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="month-switcher-label" aria-live="polite">{monthLabel(month)}</span>
      <button
        type="button"
        className="month-switcher-btn"
        aria-label="Next month"
        onClick={() => onChange(nextMonthStr(month))}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
