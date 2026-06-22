import { ChevronLeft, ChevronRight } from 'lucide-react'
import { prevMonthStr, nextMonthStr } from '../../utils/dateUtils.js'

// Reusable month navigation control used across all three tabs (Overview,
// Transactions, Budget): prev/next chevron buttons for stepping one month at
// a time, plus a native month input in the middle for jumping directly to
// any month, regardless of transaction history.
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
      <input
        type="month"
        className="month-switcher-input"
        value={month}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select month"
      />
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
