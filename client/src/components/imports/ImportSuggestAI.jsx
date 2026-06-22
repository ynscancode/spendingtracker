// Opt-in "Suggest with AI" control for Step 2 (Columns). Strictly additive:
// nothing leaves the machine until the user explicitly clicks the button AND
// then explicitly confirms a payload preview naming the external service.
// On any failure/malformed/null response, this calls onResult(null) and the
// caller (ImportModal) keeps its existing deterministic prefill untouched —
// see the contract on the team board ("IMPLEMENTED: server-side LLM-suggest
// contract").
import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '../../api/client.js'

const MAX_SAMPLE_ROWS = 5
const REDACTED = '<redacted>'

// Stable, dependency-free hash of headers+rows so re-clicking "Suggest" on
// the same file content reuses the server's in-memory cache (see contract:
// fileHash). Not cryptographic — just needs to be stable for identical input
// and cheap to compute client-side.
function stableHash(value) {
  const str = JSON.stringify(value)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)
}

// Builds the exact payload that will be sent — the same redaction the server
// performs (commentCol-keyed) is also applied here client-side so the
// preview shown to the user is byte-for-byte what leaves the machine, not an
// approximation of it.
function buildPayload({ headers, rows, commentCol, accountCol }) {
  const sampleRows = rows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    headers.map((_, colIndex) => {
      const cell = row[colIndex]
      if (commentCol != null && colIndex === commentCol) return REDACTED
      return cell == null ? '' : String(cell)
    })
  )
  const accountLabels =
    accountCol != null
      ? [...new Set(rows.map((r) => String(r[accountCol] ?? '').trim()).filter(Boolean))]
      : []
  const fileHash = stableHash({ headers, rows: rows.slice(0, MAX_SAMPLE_ROWS) })
  return {
    headers,
    sampleRows,
    accountLabels,
    commentCol: commentCol == null ? null : commentCol,
    fileHash,
  }
}

export default function ImportSuggestAI({ headers, rows, columnMapping, onResult }) {
  const [showPreview, setShowPreview] = useState(false)
  const [status, setStatus] = useState('idle') // idle | loading | done
  const [note, setNote] = useState(null)

  const payload = useMemo(
    () => buildPayload({ headers, rows, commentCol: columnMapping.commentCol, accountCol: columnMapping.accountCol }),
    [headers, rows, columnMapping.commentCol, columnMapping.accountCol]
  )

  async function handleConfirmSend() {
    setShowPreview(false)
    setStatus('loading')
    setNote(null)
    try {
      const data = await api.suggestImportMapping(payload)
      const suggestion = data?.suggestion
      if (
        suggestion &&
        suggestion.columnMapping &&
        Array.isArray(suggestion.categoryMapping) &&
        Array.isArray(suggestion.accountMapping)
      ) {
        onResult(suggestion)
        setNote('AI suggestion applied — review every field below.')
      } else {
        onResult(null)
        setNote('AI suggestion unavailable — using local mapping.')
      }
    } catch {
      onResult(null)
      setNote('AI suggestion unavailable — using local mapping.')
    } finally {
      setStatus('done')
    }
  }

  return (
    <div className="import-ai-suggest">
      <button
        type="button"
        className="btn-secondary import-ai-suggest-btn"
        onClick={() => setShowPreview(true)}
        disabled={status === 'loading'}
      >
        <Sparkles size={14} aria-hidden="true" />
        {status === 'loading' ? 'Suggesting…' : 'Suggest with AI'}
      </button>
      {note && (
        <span className="import-ai-suggest-note" role="status">
          {note}
        </span>
      )}

      {showPreview && (
        <div className="import-ai-consent-overlay" onClick={() => setShowPreview(false)}>
          <div className="import-ai-consent-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm data sent to AI">
            <h3 style={{ marginTop: 0 }}>Send this file data to Ollama Cloud?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              This is optional. Clicking confirm sends the data below to <strong>Ollama Cloud</strong>, an
              external third-party AI service, to suggest a column/category/account mapping. The local
              mapping below this button keeps working with no AI call. Comment text is redacted before
              sending, and at most {MAX_SAMPLE_ROWS} sample rows are sent.
            </p>

            <h4 style={{ marginBottom: 4 }}>Headers ({payload.headers.length})</h4>
            <div className="import-ai-consent-block">{payload.headers.join(', ')}</div>

            <h4 style={{ marginBottom: 4 }}>
              Sample rows ({payload.sampleRows.length}
              {payload.commentCol != null ? ', comment column redacted' : ''})
            </h4>
            <div className="import-table-wrap import-ai-consent-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    {payload.headers.map((h, i) => (
                      <th key={i}>{h || `Column ${i + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.sampleRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {payload.accountLabels.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Account labels ({payload.accountLabels.length})</h4>
                <div className="import-ai-consent-block">{payload.accountLabels.join(', ')}</div>
              </>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowPreview(false)}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={handleConfirmSend}>
                Confirm and send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
