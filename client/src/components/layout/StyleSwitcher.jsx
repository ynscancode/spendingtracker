import { useTheme, THEME_OPTIONS } from '../../contexts/theme.js'

// Theme ("Style") segmented control. Same useTheme()/THEME_OPTIONS/setTheme
// wiring the Header always had; extracted so the desktop header and the phone
// account sheet render one identical control.
export default function StyleSwitcher({ className = '' }) {
  const { theme, setTheme } = useTheme()

  return (
    <div className={`pill-group ${className}`.trim()} role="group" aria-label="Style">
      <span className="pill-group-label" aria-hidden="true">Style</span>
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`pill-btn ${theme === opt.key ? 'active' : ''}`}
          aria-pressed={theme === opt.key}
          onClick={() => setTheme(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
