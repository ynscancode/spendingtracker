import { useEffect, useMemo, useState } from 'react'
import { THEMES, THEME_COLOR_SCHEME, STORAGE_KEY, DEFAULT_THEME, ThemeContext } from './theme.js'

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && THEMES[stored] ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // localStorage unavailable (e.g. private mode) — non-fatal, just don't persist.
    }
  }, [theme])

  const tokens = THEMES[theme] || THEMES[DEFAULT_THEME]

  const rootStyle = useMemo(() => {
    const style = { ...tokens }
    style.background = 'var(--bg)'
    style.color = 'var(--text)'
    style.minHeight = '100vh'
    style.fontFamily = 'var(--font-ui)'
    style.colorScheme = THEME_COLOR_SCHEME[theme] || THEME_COLOR_SCHEME[DEFAULT_THEME]
    return style
  }, [tokens, theme])

  const value = useMemo(() => ({ theme, setTheme, tokens }), [theme, tokens])

  return (
    <ThemeContext.Provider value={value}>
      <div className="app-root" style={rootStyle}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}
