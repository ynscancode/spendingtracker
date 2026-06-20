import { createContext, useContext } from 'react'

// Fallback color for categories with no server-assigned color (defensive only —
// the API always includes `color` per the GET /api/categories contract) and for
// system categories like transfer-in/transfer-out that never appear in the
// outgoing/incoming lists this context exposes.
export const FALLBACK_COLOR = '#8A8F98'

export const CategoriesContext = createContext(null)

export function useCategories() {
  const ctx = useContext(CategoriesContext)
  if (!ctx) throw new Error('useCategories must be used within a CategoriesProvider')
  return ctx
}
