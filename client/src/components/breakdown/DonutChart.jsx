import { RADIUS } from '../../utils/donutMath.js'

// Ring thickness and outline geometry (viewBox units). The ring is centred on
// RADIUS (dash lengths in donutMath.js are derived from it), so it must stay
// at RADIUS; the viewBox is padded so the thicker Colour Block ring fits.
const RING = 26
const OUTLINE = 1.3

// Raw SVG ring/donut chart matching the design spec's stroke-dasharray
// segment approach: one background track circle, then one stroke segment
// per category, rotated -90deg so segments start at 12 o'clock. Two thin
// --line circles outline the ring's outer and inner edge (prototype .donut).
export default function DonutChart({ segments, centerLabel, centerValue }) {
  return (
    <div className="donut-wrap">
      <svg width="100%" height="100%" viewBox="-5 -5 130 130">
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--soft)" strokeWidth={RING} />
        <g transform="rotate(-90 60 60)">
          {segments.map((s, i) => (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={s.color}
              strokeWidth={RING}
              strokeDasharray={s.dash}
              strokeDashoffset={s.offset}
              style={{ transition: 'stroke-dasharray .6s ease, stroke-dashoffset .6s ease' }}
            />
          ))}
        </g>
        <circle cx="60" cy="60" r={RADIUS + RING / 2 - OUTLINE / 2} fill="none" stroke="var(--line)" strokeWidth={OUTLINE} />
        <circle cx="60" cy="60" r={RADIUS - RING / 2 + OUTLINE / 2} fill="none" stroke="var(--line)" strokeWidth={OUTLINE} />
      </svg>
      <div className="donut-center">
        <div className="donut-center-label">{centerLabel}</div>
        <div className="donut-center-value">{centerValue}</div>
      </div>
    </div>
  )
}
