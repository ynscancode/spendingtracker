import { NavLink } from 'react-router-dom'
import { useTheme, THEME_OPTIONS } from '../../contexts/theme.js'

export default function Header() {
  const { theme, setTheme } = useTheme()

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Ledger</span>
        </div>
        <nav className="app-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>Overview</NavLink>
          <NavLink to="/transactions" className={({ isActive }) => (isActive ? 'active' : '')}>Transactions</NavLink>
          <NavLink to="/breakdown" className={({ isActive }) => (isActive ? 'active' : '')}>Breakdown</NavLink>
          <NavLink to="/budget" className={({ isActive }) => (isActive ? 'active' : '')}>Budget</NavLink>
        </nav>
      </div>
      <div className="pill-group">
        <span className="pill-group-label">Style</span>
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`pill-btn ${theme === opt.key ? 'active' : ''}`}
            onClick={() => setTheme(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </header>
  )
}
