import { createContext, useContext } from 'react'
import { monoGrey, PALETTE_SIZE } from '../utils/categoryColor.js'

// Three theme token sets from the Colour Block redesign (design/DESIGN-HANDOFF.md §1).
// Keys are kept as refined / editorial / terminal so previously stored
// localStorage values stay valid: refined = handoff "dark", editorial = "light",
// terminal = "mono". Applied inline on .app-root by ThemeProvider.
//
// Legacy variables (--text, --green, ...) are aliased to the new tokens INSIDE
// each theme object. var() in a custom property resolves on the element that
// declares it, so the aliases must live on .app-root next to the tokens they
// reference (an alias declared on :root would resolve against nothing).
const FONT = "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif"

const LIGHT_PALETTE = {
  '--p0': '#8EE3D0', '--p1': '#FFC2E0', '--p2': '#9CC8FF', '--p3': '#C9B8FF', '--p4': '#FFB27A',
  '--p5': '#F2A6E8', '--p6': '#B8C4D6', '--p7': '#D9C3A5', '--p8': '#D9D9D9', '--p9': '#7FD6F0',
}

// Mono: a distinct grey per category rank (utils/categoryColor.js monoGrey).
// Ranks 0..9 are these tokens; higher ranks are emitted as literal greys.
const MONO_PALETTE = Object.fromEntries(
  Array.from({ length: PALETTE_SIZE }, (_, i) => [`--p${i}`, monoGrey(i)]),
)

// Legacy names still referenced by index.css / JSX, mapped onto the new tokens.
const legacyAliases = (warningText) => ({
  '--text': 'var(--ink)', '--green': 'var(--pos)', '--red': 'var(--neg)', '--accent': 'var(--tomato)',
  '--topup': 'var(--pink)', '--faint': 'var(--muted)',
  '--surface': 'var(--card)', '--surface-2': 'var(--soft)',
  '--border': 'var(--line)', '--border-strong': 'var(--rule)',
  '--accent-soft': 'var(--soft)', '--accent-border': 'var(--line)', '--on-accent': '#121212',
  '--warning': 'var(--yellow)', '--warning-text': warningText,
  '--money-in': 'var(--pos)', '--money-out': 'var(--neg)', '--transfer-out': 'var(--pink)',
  '--font-ui': 'var(--font)', '--font-num': 'var(--font)', '--font-display': 'var(--font)',
  '--display-weight': '800', '--display-tracking': '-.05em',
  '--radius': '18px', '--radius-sm': '12px',
})

export const THEMES = {
  // handoff "dark"
  refined: {
    '--bg': '#111111', '--card': '#1C1C1C', '--ink': '#F2F2F2', '--line': '#F2F2F2', '--shadow': '#F2F2F2',
    '--muted': '#B8B8B8', '--soft': '#2A2A2A', '--rule': '#2E2E2E',
    '--lime': '#CFF25A', '--sky': '#9CC8FF', '--tomato': '#FF7A5C', '--pink': '#FFC2E0', '--yellow': '#FFD84D',
    '--pos': '#9BE38F', '--neg': '#FF9A80', '--inv': '#CFF25A', '--oninv': '#121212', '--onc': '#121212',
    '--scrim': 'rgba(0,0,0,.7)',
    '--focus': 'var(--sky)',
    ...LIGHT_PALETTE,
    '--font': FONT,
    ...legacyAliases('var(--yellow)'),
  },
  // handoff "light"
  editorial: {
    '--bg': '#EDEDED', '--card': '#FFFFFF', '--ink': '#121212', '--line': '#121212', '--shadow': '#121212',
    '--muted': '#4D4D4D', '--soft': '#F1F1F1', '--rule': '#E3E3E3',
    '--lime': '#CFF25A', '--sky': '#9CC8FF', '--tomato': '#FF6B4A', '--pink': '#FFC2E0', '--yellow': '#FFD84D',
    '--pos': '#1E7A3C', '--neg': '#C2361A', '--inv': '#121212', '--oninv': '#FFFFFF', '--onc': '#121212',
    '--scrim': 'rgba(18,18,18,.55)',
    '--focus': 'var(--ink)',
    ...LIGHT_PALETTE,
    '--font': FONT,
    ...legacyAliases('var(--ink)'),
  },
  // handoff "mono"
  terminal: {
    '--bg': '#EFEFEF', '--card': '#FFFFFF', '--ink': '#111111', '--line': '#111111', '--shadow': '#111111',
    '--muted': '#4D4D4D', '--soft': '#F6F6F6', '--rule': '#E3E3E3',
    '--lime': '#D9D9D9', '--sky': '#ECECEC', '--tomato': '#8A8A8A', '--pink': '#C4C4C4', '--yellow': '#B0B0B0',
    '--pos': '#111111', '--neg': '#111111', '--inv': '#111111', '--oninv': '#FFFFFF', '--onc': '#111111',
    '--scrim': 'rgba(17,17,17,.55)',
    '--focus': 'var(--ink)',
    ...MONO_PALETTE,
    '--font': FONT,
    ...legacyAliases('var(--ink)'),
  },
}

// Native control / scrollbar rendering hint per theme (presentation only).
export const THEME_COLOR_SCHEME = { refined: 'dark', editorial: 'light', terminal: 'light' }

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
