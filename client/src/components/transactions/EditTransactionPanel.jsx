import { useState } from 'react'
import { Check, X } from 'lucide-react'

export default function EditTransactionPanel({ txn, onSave, onCancel }) {
  const [date, setDate] = useState(txn.date)
  const [amount, setAmount] = useState(txn.amount)
  const [comment, setComment] = useState(txn.comment)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Amount must be a positive number')
      return
    }
    try {
      await onSave(txn.id, { date, amount: amountNum, comment })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 className="edit-panel-title">Edit transaction{txn.is_transfer ? ' (transfer - both legs will update)' : ''}</h3>
      <form className="txn-form" onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Amount
          <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label>
          Comment
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <button type="submit" className="btn-with-icon"><Check size={16} aria-hidden="true" /> Save</button>
        <button type="button" className="btn btn-with-icon btn-neutral" onClick={onCancel}><X size={16} aria-hidden="true" /> Cancel</button>
        {error && <span className="error-text" role="alert">{error}</span>}
      </form>
    </div>
  )
}
