export default function CategoryBarList({ categories, total, mode }) {
  const max = Math.max(1, ...categories.map((c) => c.value))

  function valueText(value) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0
    if (mode === 'cash') return `$${value.toFixed(2)}`
    if (mode === 'percent') return `${pct}%`
    return `$${value.toFixed(2)} · ${pct}%`
  }

  if (categories.length === 0) {
    return <p className="empty-text">No data for this month.</p>
  }

  return (
    <div className="donut-legend">
      {categories.map((c) => (
        <div className="cat-bar-row" key={c.key ?? c.category}>
          <div className="cat-bar-row-head">
            <span className="cat-bar-row-label">
              <span className="cat-bar-row-swatch" style={{ background: c.color }} />
              {c.category}
            </span>
            <span className="cat-bar-row-value">{valueText(c.value)}</span>
          </div>
          <div className="cat-bar-track thin">
            <div className="cat-bar-fill" style={{ width: `${Math.max(3, Math.round((c.value / max) * 100))}%`, background: c.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
