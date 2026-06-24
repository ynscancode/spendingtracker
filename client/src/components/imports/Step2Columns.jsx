// Column-mapping step: maps the file's actual headers to date/amount/
// direction/category/comment/account, with a best-guess prefill (computed
// by the caller via guessColumnMapping before this step mounts). Date format
// is a required, never-guessed selector since locale is genuinely ambiguous.
import { ACCOUNT_NAMES } from '../../constants/categories.js'

const NONE = '__none__'

function ColumnSelect({ label, headers, value, onChange, required }) {
  return (
    <label className="form-field">
      {label}
      {required && <span className="visually-hidden"> (required)</span>}
      <select
        value={value == null ? NONE : String(value)}
        onChange={(e) => onChange(e.target.value === NONE ? null : Number(e.target.value))}
      >
        {!required && <option value={NONE}>— Not in file —</option>}
        {required && value == null && <option value={NONE}>— Select a column —</option>}
        {headers.map((header, index) => (
          <option key={index} value={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function Step2Columns({ headers, mapping, onChange, rawGrid, dataStartRow, onDataStartRowChange }) {
  function set(key, value) {
    onChange({ ...mapping, [key]: value })
  }

  // Validate 1 <= n <= rawGrid.length - 1 (need at least 1 data row left
  // after the header); clamp/ignore out-of-range input rather than letting
  // the wizard end up with zero data rows or a header row past the grid end.
  function handleDataStartRowChange(e) {
    const n = Number(e.target.value)
    if (!Number.isInteger(n) || n < 1 || n > rawGrid.length - 1) return
    onDataStartRowChange(n)
  }

  const headerRowIndex = Math.max(0, dataStartRow - 1)
  // Small preview window around the chosen header row so the user can see
  // which row becomes the header before committing to an offset.
  const previewStart = Math.max(0, headerRowIndex - 1)
  const previewRows = rawGrid.slice(previewStart, previewStart + 4)

  return (
    <div>
      <p className="error-text" role="status" style={{ color: 'var(--muted)', marginBottom: 14 }}>
        Map the file's columns below. Fields marked required must be set before continuing.
      </p>

      <div className="import-data-start-row" style={{ marginBottom: 16 }}>
        <label className="form-field">
          Data starts on row
          <input
            type="number"
            min={1}
            max={Math.max(1, rawGrid.length - 1)}
            value={dataStartRow}
            onChange={handleDataStartRowChange}
          />
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          If your file has a legend or title rows above the column headers, set the row your column headers are on.
        </p>
        {previewRows.length > 0 && (
          <div className="import-table-wrap">
            <table className="import-table">
              <tbody>
                {previewRows.map((row, i) => {
                  const rowNumber = previewStart + i + 1 // 1-based, matches the input's convention
                  const isHeaderRow = previewStart + i === headerRowIndex
                  return (
                    <tr key={rowNumber} style={isHeaderRow ? { fontWeight: 600 } : undefined}>
                      <td style={{ color: 'var(--muted)' }}>
                        {rowNumber}
                        {isHeaderRow ? ' (header)' : ''}
                      </td>
                      {row.map((cell, ci) => (
                        <td key={ci}>{cell}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <label className="form-field full" style={{ marginBottom: 14 }}>
        Account scope
        <div className="pill-group">
          <button
            type="button"
            className={`pill-btn ${mapping.accountScope === 'single' ? 'active' : ''}`}
            onClick={() => onChange({ ...mapping, accountScope: 'single', accountCol: null })}
          >
            Single account (whole file is one account)
          </button>
          <button
            type="button"
            className={`pill-btn ${mapping.accountScope === 'multiple' ? 'active' : ''}`}
            onClick={() => set('accountScope', 'multiple')}
          >
            Multiple accounts (file has an account column)
          </button>
        </div>
      </label>

      <div className="import-mapping-grid">
        <ColumnSelect label="Date column" headers={headers} value={mapping.dateCol} onChange={(v) => set('dateCol', v)} required />

        <label className="form-field">
          Date format
          <select value={mapping.dateFormat || ''} onChange={(e) => set('dateFormat', e.target.value || null)}>
            <option value="">— Select a format —</option>
            <option value="YMD">Year-Month-Day (2026-06-21)</option>
            <option value="MDY">Month-Day-Year (06/21/2026)</option>
            <option value="DMY">Day-Month-Year (21/06/2026)</option>
          </select>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            Required even for dates that look unambiguous — numeric dates can't be guessed reliably across locales.
          </span>
        </label>

        <label className="form-field full">
          Amount columns
          <div className="pill-group">
            <button
              type="button"
              className={`pill-btn ${mapping.amountMode === 'single' ? 'active' : ''}`}
              onClick={() => set('amountMode', 'single')}
            >
              Single amount column
            </button>
            <button
              type="button"
              className={`pill-btn ${mapping.amountMode === 'debit-credit' ? 'active' : ''}`}
              onClick={() => set('amountMode', 'debit-credit')}
            >
              Separate debit / credit columns
            </button>
          </div>
        </label>

        {mapping.amountMode === 'single' ? (
          <>
            <ColumnSelect label="Amount column" headers={headers} value={mapping.amountCol} onChange={(v) => set('amountCol', v)} required />
            <ColumnSelect label="Direction column (optional)" headers={headers} value={mapping.directionCol} onChange={(v) => set('directionCol', v)} />
          </>
        ) : (
          <>
            <ColumnSelect label="Debit column" headers={headers} value={mapping.debitCol} onChange={(v) => set('debitCol', v)} required />
            <ColumnSelect label="Credit column" headers={headers} value={mapping.creditCol} onChange={(v) => set('creditCol', v)} required />
          </>
        )}

        {/* Category column is optional (Fix 2) — rows with no column or a
            blank cell fall back to "Uncategorized" rather than being
            required up front. */}
        <ColumnSelect label="Category column (optional)" headers={headers} value={mapping.categoryCol} onChange={(v) => set('categoryCol', v)} />
        <ColumnSelect label="Comment column (optional)" headers={headers} value={mapping.commentCol} onChange={(v) => set('commentCol', v)} />

        {mapping.accountScope === 'multiple' ? (
          <ColumnSelect label="Account column" headers={headers} value={mapping.accountCol} onChange={(v) => set('accountCol', v)} required />
        ) : (
          <label className="form-field">
            Import all rows into
            <select
              value={mapping.fixedAccountId ?? ''}
              onChange={(e) => set('fixedAccountId', Number(e.target.value))}
            >
              {Object.entries(ACCOUNT_NAMES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
