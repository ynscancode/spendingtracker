import { NavLink } from 'react-router-dom'
import AccountSwitcher from './AccountSwitcher.jsx'
import StyleSwitcher from './StyleSwitcher.jsx'

const navClass = ({ isActive }) => (isActive ? 'active' : '')

export default function Header() {
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-bar">
            <div className="app-header-left">
              <div className="brand">
                <span className="brand-mark" aria-hidden="true" />
                <span className="brand-name">Ledger</span>
              </div>
              {/* Desktop nav pills; hidden (display:none) at <=760px where the
                  bottom tab bar below replaces it, so only one nav is exposed. */}
              <nav className="app-nav" aria-label="Primary">
                <NavLink to="/" end className={navClass}>Overview</NavLink>
                <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
                <NavLink to="/budget" className={navClass}>Budget</NavLink>
              </nav>
            </div>
            <div className="app-header-right">
              <StyleSwitcher className="app-header-style" />
              <AccountSwitcher />
            </div>
          </div>
        </div>
      </header>
      {/* Phone bottom tab bar (<=760px). Sibling of <header> (not inside it) and
          outside every page's .page-animate, so position:fixed is viewport-relative. */}
      <nav className="tabbar" aria-label="Primary tabs">
        <NavLink to="/" end className={navClass}>Overview</NavLink>
        <NavLink to="/transactions" className={navClass}>Transactions</NavLink>
        <NavLink to="/budget" className={navClass}>Budget</NavLink>
      </nav>
    </>
  )
}
