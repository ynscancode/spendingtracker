import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { getModalRoot } from '../../utils/modalRoot.js'

// Phone-only "+" floating action button (display:none above 760px, see
// index.css). Rendered by the pages that own an add-transaction handler
// (Dashboard, Transactions) and given that SAME handler as `onClick`. Portaled
// to #modal-root because the pages sit inside `.page-animate`, whose CSS
// transform would otherwise become the containing block for position:fixed.
export default function AddFab({ onClick }) {
  return createPortal(
    <button type="button" className="fab" onClick={onClick} aria-label="Add transaction">
      <Plus size={26} strokeWidth={3} aria-hidden="true" />
    </button>,
    getModalRoot(),
  )
}
