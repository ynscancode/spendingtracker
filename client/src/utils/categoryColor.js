// Colour Block category colours: every category gets its OWN colour.
//
// Purely presentational: the server-stored category colours and
// CategoriesContext.colorFor() are left untouched, nothing is stored. Rule: for
// one user no two categories share a colour, across both accounts, both
// directions and every view.
//
// How:
//   1. Take ALL the user's non-system categories (Spending + Savings, outgoing +
//      incoming) as one combined list and order it by the server `id`
//      (creation order). id is stable, so adding a category appends a new rank
//      and no existing category's colour moves. (Deleting one still shifts the
//      ranks after it: any rank-based scheme has that property.)
//   2. rank r < 10        -> var(--p{r})            (theme palette token)
//      rank r >= 10       -> generated pastel (see generatedColor)
//      Mono theme         -> a distinct grey per rank (see monoGrey)
//   3. transfer-in / transfer-out -> var(--card); callers draw these as a
//      dashed chip. They are system rows and are not part of the ranking.
//
// Fallback chain (a lookup miss must never yield undefined, which would render
// as the literal text "undefined" in an inline style/SVG attribute):
//   1. exact (accountId, name[, direction]) match, then case-insensitive/trimmed
//   2. any category of that name in the combined list (wrong account passed)
//   3. the caller-supplied `fallback` (the existing colorFor() result)
//   4. NEUTRAL_COLOR
import { FALLBACK_COLOR } from '../contexts/categories.js'

export const PALETTE_SIZE = 10
export const TRANSFER_COLOR = 'var(--card)'
export const NEUTRAL_COLOR = FALLBACK_COLOR

// ---- Theme palette (mirror of LIGHT_PALETTE in contexts/theme.js) ----------
// Needed only so generated colours can be kept clear of p0..p9 numerically.
export const BASE_PALETTE = [
  '#8EE3D0', '#FFC2E0', '#9CC8FF', '#C9B8FF', '#FFB27A',
  '#F2A6E8', '#B8C4D6', '#D9C3A5', '#D9D9D9', '#7FD6F0',
]

// Reserved for budget health (lime / yellow / tomato): never generated.
export const RESERVED_COLORS = ['#CFF25A', '#FFD84D', '#FF6B4A', '#FF7A5C']
export const RESERVED_HUES = [11, 47, 74]
export const RESERVED_HUE_BAND = 14 // degrees either side of a reserved hue

// ---- Generated colours (rank >= 10) -----------------------------------------
export const GOLDEN_ANGLE = 137.508
export const HUE_START = 20
export const GEN_SATURATION = 72 // percent
export const GEN_LIGHTNESS = [74, 64, 84, 70] // cycled per candidate for extra separation
export const MIN_DELTA_E = 22 // preferred CIE76 distance to p0..p9, reserved colours and every earlier colour
export const MIN_FLOOR_DELTA_E = 6 // never accept closer than this
export const CONTRAST_FLOOR = 4.5
export const GEN_TEXT = '#121212'

// ---- Mono (theme key `terminal`) ---------------------------------------------
// Distinct greys in [MONO_MIN, MONO_MAX], handed out in golden-ratio order so any
// prefix of ranks is spread as evenly as possible and rank n never changes when
// rank n+1 exists. #7C7C7C is the darkest grey that keeps 4.5:1 with #111 text.
export const MONO_MIN = 0x80
export const MONO_MAX = 0xf0
export const MONO_TEXT = '#111111'
const INV_PHI = 0.6180339887498949

const TRANSFER_NAMES = ['transfer-in', 'transfer-out']

export function isTransferCategory(name) {
  return typeof name === 'string' && TRANSFER_NAMES.includes(name.trim().toLowerCase())
}

// ---- colour maths ------------------------------------------------------------
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function hslToRgb(h, s, l) {
  const sat = s / 100
  const lig = l / 100
  const k = (n) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}

function linear(v) {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrast(hexA, hexB) {
  const a = luminance(hexA)
  const b = luminance(hexB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

export function deltaE(hexA, hexB) {
  const a = toLab(hexA)
  const b = toLab(hexB)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// ---- generated colours --------------------------------------------------------
// Deterministic. The candidate pool is the golden-angle hue sequence
// (hue_j = HUE_START + j * 137.508) with a cycling lightness. Slot k (rank 10 + k)
// takes the FIRST unused pool candidate that (a) is outside every reserved hue
// band, (b) meets the contrast floor against #121212 and (c) is at least the
// current distance threshold (CIE76 delta E) from p0..p9, the reserved colours
// and every colour already handed out. The threshold starts at MIN_DELTA_E and,
// only when the pool has nothing left at that distance, steps down by 1 (never
// below MIN_FLOOR_DELTA_E), so every rank still gets a unique colour while the
// early ones stay as far apart as possible. The result is cached and each slot
// depends only on earlier slots, so adding a category never changes older ones.
const generated = []
const POOL_SIZE = 720

const pool = []
for (let j = 0; j < POOL_SIZE; j++) {
  const hue = (HUE_START + j * GOLDEN_ANGLE) % 360
  if (RESERVED_HUES.some((h) => hueDistance(hue, h) < RESERVED_HUE_BAND)) continue
  const hex = rgbToHex(hslToRgb(hue, GEN_SATURATION, GEN_LIGHTNESS[j % GEN_LIGHTNESS.length]))
  if (contrast(hex, GEN_TEXT) < CONTRAST_FLOOR) continue
  pool.push(hex)
}

function nextGenerated() {
  const taken = [...BASE_PALETTE, ...RESERVED_COLORS, ...generated]
  for (let t = MIN_DELTA_E; t >= MIN_FLOOR_DELTA_E; t--) {
    const hit = pool.find((hex) => taken.every((o) => deltaE(hex, o) >= t))
    if (hit) return hit
  }
  return null
}

export function generatedColor(k) {
  while (generated.length <= k) {
    const hex = nextGenerated()
    if (!hex) break
    generated.push(hex)
  }
  if (k < generated.length) return generated[k]
  // Pool exhausted (far beyond any realistic category count): still never
  // undefined, via a sub-degree hue walk.
  const extra = k - generated.length + 1
  return rgbToHex(hslToRgb((HUE_START + extra * 0.7) % 360, 45, 72))
}

// ---- mono greys ----------------------------------------------------------------
const greys = []

export function monoGrey(rank) {
  while (greys.length <= rank) {
    const r = greys.length
    const pos = (r * INV_PHI) % 1
    let level = MONO_MIN + Math.round(pos * (MONO_MAX - MONO_MIN))
    // Rounding collision (only possible beyond ~50 ranks): take the nearest free level.
    for (let step = 1; greys.includes(level) && step <= MONO_MAX - MONO_MIN; step++) {
      const up = level + step
      const down = level - step
      if (up <= MONO_MAX && !greys.includes(up)) level = up
      else if (down >= MONO_MIN && !greys.includes(down)) level = down
    }
    greys.push(level)
  }
  const v = greys[rank].toString(16).padStart(2, '0').toUpperCase()
  return `#${v}${v}${v}`
}

// ---- rank -> colour --------------------------------------------------------------
// scheme: 'color' (Dark / Light) or 'mono'. The palette values are the same in
// Dark and Light, so only mono differs. Ranks < 10 stay on the theme tokens
// (--p0..--p9; mono defines those from monoGrey, see contexts/theme.js).
export function rankColor(rank) {
  return rank < PALETTE_SIZE ? `var(--p${rank})` : generatedColor(rank - PALETTE_SIZE)
}

export function rankColorMono(rank) {
  return rank < PALETTE_SIZE ? `var(--p${rank})` : monoGrey(rank)
}

// Concrete hex for a rank (tokens resolved), used by the proof script and tests.
export function rankHex(rank, scheme = 'color') {
  if (scheme === 'mono') return monoGrey(rank)
  return rank < PALETTE_SIZE ? BASE_PALETTE[rank] : generatedColor(rank - PALETTE_SIZE)
}

// ---- the combined, ordered list -----------------------------------------------------
// groups: [{ accountId, direction: 'out' | 'in', list }] where list is the array
// from outgoingFor(accountId) / incomingFor(accountId). Returns entries
// { accountId, direction, name, id, rank } sorted by id (creation order); an
// entry without a numeric id sorts after all that have one, in encounter order.
export function buildRanking(groups) {
  const entries = []
  let seq = 0
  for (const g of groups) {
    if (!g || !Array.isArray(g.list)) continue
    for (const c of g.list) {
      if (!c || typeof c.name !== 'string' || isTransferCategory(c.name)) continue
      const id = Number.isFinite(Number(c.id)) && c.id !== null && c.id !== '' ? Number(c.id) : Infinity
      entries.push({ accountId: g.accountId, direction: g.direction, name: c.name, id, seq: seq++ })
    }
  }
  entries.sort((a, b) => (a.id === b.id ? a.seq - b.seq : a.id < b.id ? -1 : 1))
  return entries.map((e, rank) => ({ accountId: e.accountId, direction: e.direction, name: e.name, id: e.id, rank }))
}

function find(entries, name, accountId, direction) {
  const exact = entries.find((e) => e.name === name
    && (accountId == null || e.accountId === accountId)
    && (direction == null || e.direction === direction))
  if (exact) return exact
  const wanted = name.trim().toLowerCase()
  return entries.find((e) => e.name.trim().toLowerCase() === wanted
    && (accountId == null || e.accountId === accountId)
    && (direction == null || e.direction === direction))
}

// ranking: buildRanking() output. mono: true in the Mono theme.
export function categoryColor({ ranking, accountId, name, direction, mono = false, fallback }) {
  if (isTransferCategory(name)) return TRANSFER_COLOR
  if (typeof name === 'string' && Array.isArray(ranking)) {
    const dir = direction === 'in' || direction === 'out' ? direction : null
    const hit = find(ranking, name, accountId, dir)
      || find(ranking, name, accountId, null)
      || find(ranking, name, null, dir)
      || find(ranking, name, null, null)
    if (hit) return mono ? rankColorMono(hit.rank) : rankColor(hit.rank)
  }
  return fallback || NEUTRAL_COLOR
}
