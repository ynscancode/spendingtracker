// Pure scale maths for the Dashboard "Daily spending" bar chart.
//
// Plain linear 0..max scaling lets a single huge day squash every normal day
// to a sliver. When a month has statistical outliers we instead cap the
// scale ("broken" bars); with no outliers the result is exactly the legacy
// linear maxDay so the chart renders identically to before.

// A day is an outlier when its total exceeds this multiple of the median
// non-zero day total.
export const OUTLIER_MULTIPLE = 3
// Fewer non-zero days than this and the median is meaningless: never clip.
export const MIN_SAMPLE_DAYS = 4
// Headroom above the tallest un-clipped bar / budget line when clipping.
export const CEILING_HEADROOM = 1.15

function median(sortedAsc) {
  const n = sortedAsc.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
}

/**
 * @param {number[]|Object<string, number>} dayTotals array (index = key) or map
 *   keyed by day number. Non-finite / negative values are treated as 0.
 * @param {number|null} dailyBudget null/undefined = no budget line.
 * @returns {{ maxDay:number, ceiling:number, median:number, threshold:number,
 *   hasOutliers:boolean, clipped:Object<string, boolean> }}
 *   `maxDay` is the divisor for bar heights (== ceiling when clipping).
 *   `clipped[key]` is true only for days drawn at full height with a break.
 */
export function computeDailyScale(dayTotals, dailyBudget = null) {
  const entries = Array.isArray(dayTotals)
    ? dayTotals.map((v, i) => [String(i), v])
    : Object.entries(dayTotals || {})
  const clean = entries.map(([k, v]) => [k, Number.isFinite(v) && v > 0 ? v : 0])
  const values = clean.map(([, v]) => v)
  const hasBudget = typeof dailyBudget === 'number' && Number.isFinite(dailyBudget)

  // Legacy formula, kept verbatim in behaviour.
  const legacyMax = hasBudget
    ? Math.max(1, dailyBudget, ...values)
    : Math.max(1, ...values)
  const none = { maxDay: legacyMax, ceiling: legacyMax, median: 0, threshold: Infinity, hasOutliers: false, clipped: {} }

  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nonZero.length < MIN_SAMPLE_DAYS) return { ...none, median: median(nonZero) }

  const med = median(nonZero)
  const threshold = med * OUTLIER_MULTIPLE
  const nonOutliers = nonZero.filter((v) => v <= threshold)
  if (nonOutliers.length === nonZero.length) return { ...none, median: med, threshold }

  const largestNormal = nonOutliers[nonOutliers.length - 1]
  const ceiling = Math.max(1, Math.max(largestNormal, hasBudget ? dailyBudget : 0) * CEILING_HEADROOM)

  // An outlier only needs a break if it actually pokes through the ceiling
  // (a very large budget can lift the ceiling above a mild outlier).
  const clipped = {}
  let any = false
  clean.forEach(([k, v]) => {
    if (v > threshold && v > ceiling) { clipped[k] = true; any = true }
  })
  if (!any) return { ...none, median: med, threshold }
  return { maxDay: ceiling, ceiling, median: med, threshold, hasOutliers: true, clipped }
}

/**
 * Compact amount for the break-mark label. Rounds to whole dollars first.
 *   <=0 / NaN / non-finite -> ''   (callers must not render an empty label)
 *   <1000                  -> "$950"
 *   <1M                    -> one decimal "k", trailing ".0" dropped:
 *                             2000 "$2k", 2100 "$2.1k", 1999 "$2k",
 *                             10500 "$10.5k", 999600 "$1M" (promoted, never "$1000k")
 *   >=1M                   -> one decimal "M": 1000000 "$1M", 1250000 "$1.3M"
 */
export function formatCompactAmount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  const r = Math.round(n)
  if (r < 1000) return r > 0 ? `$${r}` : ''
  const trim = (x) => String(x).replace(/\.0$/, '')
  const k = Math.round(r / 100) / 10
  if (k < 1000) return `$${trim(k)}k`
  return `$${trim(Math.round(r / 100000) / 10)}M`
}
