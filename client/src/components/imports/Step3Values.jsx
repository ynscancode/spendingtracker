// Value-mapping step: ONE row per UNIQUE category string and ONE row per
// UNIQUE account-label string found in the file — not per file row.
import { useMemo } from 'react'
import { ACCOUNT_NAMES } from '../../constants/categories.js'
import { uniqueValues } from '../../utils/importTransforms.js'

const CREATE_NEW = '__create_new__'

// uniqueValues (case-insensitive collapse, first-seen casing kept) now lives
// in importTransforms.js so this DISPLAY layer and ImportModal.jsx's
// proceedToValues SEED layer share the exact same algorithm — see the
// function's doc comment there for why that consistency matters.

export default function Step3Values({
  rows,
  columnMapping,
  categoryMapping,
  setCategoryMapping,
  accountMapping,
  setAccountMapping,
  outgoingNames,
  incomingNames,
  colorFor,
}) {
  const rawCategories = useMemo(() => uniqueValues(rows, columnMapping.categoryCol), [rows, columnMapping.categoryCol])
  const rawAccounts = useMemo(() => uniqueValues(rows, columnMapping.accountCol), [rows, columnMapping.accountCol])

  function updateCategory(raw, patch) {
    const next = new Map(categoryMapping)
    next.set(raw, { ...next.get(raw), ...patch })
    setCategoryMapping(next)
  }

  function updateAccount(raw, accountId) {
    const next = new Map(accountMapping)
    next.set(raw, accountId)
    setAccountMapping(next)
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Categories</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -4 }}>
        One row per unique category found in the file. Pick an existing category or create a new one.
      </p>
      {rawCategories.length === 0 ? (
        <p role="status" style={{ color: 'var(--muted)' }}>
          No category column mapped — every row will import as "Uncategorized".
        </p>
      ) : (
        rawCategories.map((raw) => {
          const entry = categoryMapping.get(raw) || { name: raw, list: 'outgoing', isNew: true }
          const allNames = [...new Set([...outgoingNames, ...incomingNames])]
          // Genuine unselected state (Fix 4): a numeric-coded column's
          // entries are pre-seeded as { name: null, isNew: false } by
          // buildInitialCategoryMapping — neither a real mapped name nor a
          // "create new" default. Mirrors the account select's existing
          // value="" / "— Select an account —" pattern below.
          const isUnselected = entry.name == null && !entry.isNew
          const selectValue = isUnselected ? '' : entry.isNew ? CREATE_NEW : entry.name
          return (
            <div className="import-value-row" key={raw}>
              <span className="import-value-raw" title={raw}>{raw}</span>
              <span className="import-value-arrow" aria-hidden="true">→</span>
              <select
                value={selectValue}
                aria-label={`Map category "${raw}" to`}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '') return // unselected placeholder is a no-op; can't be re-selected once a real option is chosen
                  if (value === CREATE_NEW) {
                    updateCategory(raw, { name: raw, isNew: true })
                  } else {
                    const isOutgoing = outgoingNames.includes(value)
                    updateCategory(raw, { name: value, list: isOutgoing ? 'outgoing' : 'incoming', isNew: false })
                  }
                }}
              >
                {isUnselected && <option value="">— Select a category —</option>}
                <option value={CREATE_NEW}>+ Create new: "{raw}"</option>
                {allNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {entry.isNew && (
                <select
                  value={entry.list}
                  onChange={(e) => updateCategory(raw, { list: e.target.value })}
                  aria-label={`List type for new category ${raw}`}
                >
                  <option value="outgoing">Outgoing</option>
                  <option value="incoming">Incoming</option>
                </select>
              )}
              {!entry.isNew && entry.name != null && (
                <span className="import-swatch" style={{ background: colorFor(entry.name) }} aria-hidden="true" />
              )}
            </div>
          )
        })
      )}

      <h3>Accounts</h3>
      {columnMapping.accountScope === 'multiple' ? (
        <>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -4 }}>
            Map each account label found in your file to Spending or Savings.
          </p>
          {rawAccounts.length === 0 ? (
            <p className="error-text" role="alert">Account column is mapped but no values were found.</p>
          ) : (
            rawAccounts.map((raw) => (
              <div className="import-value-row" key={raw}>
                <span className="import-value-raw" title={raw}>{raw}</span>
                <span className="import-value-arrow" aria-hidden="true">→</span>
                <select
                  value={accountMapping.get(raw) ?? ''}
                  aria-label={`Map account "${raw}" to`}
                  onChange={(e) => updateAccount(raw, Number(e.target.value))}
                >
                  {accountMapping.get(raw) == null && (
                    <option value="">— Select an account —</option>
                  )}
                  {Object.entries(ACCOUNT_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </>
      ) : (
        // Single-account mode (Fix 1): the account column is hidden/cleared
        // on Step 2, so there's nothing to map here — just confirm where
        // every row is going. The fixed-account select already communicates
        // this on the previous step; this is a read-only echo, not a second
        // place to set it.
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -4 }}>
          All rows import to {ACCOUNT_NAMES[columnMapping.fixedAccountId] ?? 'the selected account'}.
        </p>
      )}
    </div>
  )
}
