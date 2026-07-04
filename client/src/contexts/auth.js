import { createContext, useContext } from 'react'

// Context object + hook only (no JSX) — split from AuthContext.jsx the same
// way theme.js/ThemeContext.jsx and categories.js/CategoriesContext.jsx are
// split, so react-refresh's only-export-components rule stays happy and the
// provider file can export exactly one component.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
