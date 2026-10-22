import { useCallback, useMemo } from 'react'
import { useCategories } from '../contexts/categories.js'
import { useTheme } from '../contexts/theme.js'
import { buildRanking, categoryColor } from '../utils/categoryColor.js'
import { ACCOUNTS } from '../constants/categories.js'

const ACCOUNT_IDS = Object.values(ACCOUNTS)

// Drop-in replacement for useCategories().colorFor with the same
// (accountId, name) signature plus an optional direction ('out' | 'in').
// Every category of the user (both accounts, both directions) is ranked in one
// list ordered by server id, and each rank has its own unique colour. The Mono
// theme (key `terminal`) uses a distinct grey per rank instead. No state, no
// effects: it only re-derives when the context's lookups or the theme change.
export function useCategoryColor() {
  const { outgoingFor, incomingFor, colorFor } = useCategories()
  const { theme } = useTheme()
  const mono = theme === 'terminal'

  const ranking = useMemo(
    () => buildRanking(ACCOUNT_IDS.flatMap((accountId) => [
      { accountId, direction: 'out', list: outgoingFor(accountId) },
      { accountId, direction: 'in', list: incomingFor(accountId) },
    ])),
    [outgoingFor, incomingFor],
  )

  return useCallback(
    (accountId, name, direction) => categoryColor({
      ranking,
      accountId,
      name,
      direction,
      mono,
      fallback: colorFor(accountId, name),
    }),
    [ranking, mono, colorFor],
  )
}
