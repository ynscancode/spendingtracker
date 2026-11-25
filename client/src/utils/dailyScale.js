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

/**
 * Conservative width (px) of a compact label such as "$2.1k" at `fontPx`.
 * Tabular digits, "$" and "k" ~0.62em, "." ~0.3em, +1px; calibrated against
 * measured Bricolage 800 widths (11px: $950 28, $2.1k 30, $12.5k 37; 10px:
 * $950 25, $2.1k 28) and errs 0-2px wide.
 */
export function estimateLabelWidth(text, fontPx) {
  let em = 0
  for (const ch of String(text)) em += ch === '.' ? 0.3 : 0.62
  return em * fontPx + 1
}

/**
 * Greedy interval packing of the clipped-bar labels into stacked rows (row 0
 * is nearest the bars). Entries are scanned left to right; each goes in the
 * lowest row where its horizontal extent keeps `gapPx` clear of every label
 * already in that row. Nothing is ever dropped.
 *
 * @param {{index:number, widthPx:number, anchor?:'left'|'center'|'right'}[]} entries
 *   `index` = 0-based bar position. Anchors mirror the CSS: 'left' starts at
 *   the bar's left edge, 'right' ends at its right edge, 'center' is centred.
 * @param {{pitchPx:number, chartWidthPx?:number, gapPx?:number, barWidthPx?:number}} geo
 *   `pitchPx` = bar width + inter-bar gap; `barWidthPx` defaults to pitchPx.
 * @returns {{rows:number[], rowCount:number, extents:{start:number,end:number}[]}}
 *   `rows[k]` is the row of `entries[k]` (input order); `rowCount` is 0 when
 *   there are no entries; `extents` are px from the chart's left edge.
 */
export function packClipLabels(entries, { pitchPx, gapPx = 3, barWidthPx = pitchPx } = {}) {
  const extents = entries.map(({ index, widthPx, anchor = 'center' }) => {
    const left = index * pitchPx
    const start = anchor === 'left' ? left
      : anchor === 'right' ? left + barWidthPx - widthPx
      : left + barWidthPx / 2 - widthPx / 2
    return { start, end: start + widthPx }
  })
  const order = entries.map((_, k) => k).sort((a, b) => extents[a].start - extents[b].start || entries[a].index - entries[b].index)
  const placed = [] // placed[row] = extents in that row
  const rows = new Array(entries.length).fill(0)
  order.forEach((k) => {
    const e = extents[k]
    let r = 0
    while (placed[r] && placed[r].some((o) => e.start < o.end + gapPx && o.start < e.end + gapPx)) r += 1
    if (!placed[r]) placed[r] = []
    placed[r].push(e)
    rows[k] = r
  })
  return { rows, rowCount: placed.length, extents }
}
