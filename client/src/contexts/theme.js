import { createContext, useContext } from 'react'

// Three theme token sets ported verbatim from the Claude Design mockup
// ("refined" dark / "editorial" light / "terminal" mono). Keys match the
// CSS custom properties consumed throughout index.css.
export const THEMES = {
  refined: {
    '--bg': '#1A1714', '--surface': '#231F1B', '--surface-2': '#2C2722', '--border': '#383229', '--border-strong': '#2A251F',
    '--text': '#ECE7E1', '--muted': '#A79E94', '--faint': '#766D62',
    '--accent': '#CC785C', '--accent-soft': '#2E211B', '--accent-border': '#4A352B', '--on-accent': '#1A0F09',
    '--topup': '#4FB3A7', '--green': '#6BBF73', '--red': '#D98167', '--warning': '#FFE14D', '--warning-text': '#FFE14D',
    '--font-ui': "'Geist',system-ui,sans-serif", '--font-display': "'Geist',system-ui,sans-serif", '--font-num': "'Geist Mono',monospace",
    '--display-weight': '700', '--display-tracking': '-.03em',
    '--radius': '14px', '--radius-sm': '9px', '--shadow': '0 4px 16px rgba(0,0,0,.25)',
  },
  editorial: {
    '--bg': '#F4F1EA', '--surface': '#FFFFFF', '--surface-2': '#EFEBE2', '--border': '#E0DACE', '--border-strong': '#EEE9DF',
    '--text': '#2A2622', '--muted': '#7A7269', '--faint': '#A89F94',
    '--accent': '#B6542F', '--accent-soft': '#F3E6DD', '--accent-border': '#E8CDBE', '--on-accent': '#FFFFFF',
    '--topup': '#3F8C7F', '--green': '#3F8C7F', '--red': '#B6542F', '--warning': '#D9A40C', '--warning-text': '#6E4F00',
    '--font-ui': "'Geist',system-ui,sans-serif", '--font-display': "'Newsreader',Georgia,serif", '--font-num': "'Geist Mono',monospace",
    '--display-weight': '500', '--display-tracking': '-.01em',
    '--radius': '10px', '--radius-sm': '7px', '--shadow': '0 1px 2px rgba(60,50,40,.12)',
  },
  terminal: {
    '--bg': '#0C0E0D', '--surface': '#131614', '--surface-2': '#1B201D', '--border': '#283029', '--border-strong': '#1E2420',
    '--text': '#D6E2D5', '--muted': '#7E907C', '--faint': '#566154',
    '--accent': '#6FCF73', '--accent-soft': '#142119', '--accent-border': '#274d2c', '--on-accent': '#06120A',
    '--topup': '#5BC8C0', '--green': '#6FCF73', '--red': '#E47B6D', '--warning': '#FAF066', '--warning-text': '#FAF066',
    '--font-ui': "'Geist Mono',monospace", '--font-display': "'Geist Mono',monospace", '--font-num': "'Geist Mono',monospace",
    '--display-weight': '600', '--display-tracking': '-.02em',
    '--radius': '6px', '--radius-sm': '5px', '--shadow': '0 0 0 1px rgba(111,207,115,.06)',
  },
}

export const THEME_OPTIONS = [
  { key: 'refined', label: 'Dark' },
  { key: 'editorial', label: 'Light' },
  { key: 'terminal', label: 'Mono' },
]

export const STORAGE_KEY = 'ledger-theme'
export const DEFAULT_THEME = 'refined'

export const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
