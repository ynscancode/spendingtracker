import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { CategoriesContext, FALLBACK_COLOR } from './categories.js'

export function CategoriesProvider({ children }) {
  const [outgoing, setOutgoing] = useState([])
  const [incoming, setIncoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getCategories()
      setOutgoing(data.outgoing || [])
      setIncoming(data.incoming || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const colorFor = useCallback((name) => {
    const match = outgoing.find((c) => c.name === name) || incoming.find((c) => c.name === name)
    return match?.color || FALLBACK_COLOR
  }, [outgoing, incoming])

  const value = useMemo(
    () => ({ outgoing, incoming, colorFor, loading, error, refetch }),
    [outgoing, incoming, colorFor, loading, error, refetch]
  )

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
}
