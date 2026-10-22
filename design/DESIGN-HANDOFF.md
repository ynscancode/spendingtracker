# Ledger — Colour Block redesign handoff

Reference build: `ledger-prototype.html` (open it in a browser — it is the source of truth for every colour, size and layout below). This document tells you how to port that design into the real Ledger app.

## 0. Hard rules

- **Visual-only change.** Do not touch API calls, auth, the Turso data layer, routes, providers/hooks (`useTheme`, `useAuth`, `useCategories`, `useThresholds`, `useTransactionActivity`), state shape, validation logic, or localStorage keys (`ledger.dailyBudget`, theme key, `authToken`).
- Keep every existing control, label and error message. The prototype copies the live app's copy; where wording differs, the live app wins.
- Keep the three styles and their keys: `dark`, `light`, `mono`.
- The prototype fakes data, auth and export. Ignore its JS logic; port only markup structure and CSS.
- Work on a branch. Run the app after each page and compare side by side with the prototype at 1280px and 390px.

## 1. Tokens

Replace the current Claude-style tokens. Apply per theme via whatever the ThemeProvider already sets (class or `data-theme` on `<html>`).

```css
:root, [data-style="light"] {
  --bg:#EDEDED; --card:#FFFFFF; --ink:#121212; --line:#121212; --shadow:#121212;
  --muted:#4D4D4D; --soft:#F1F1F1; --rule:#E3E3E3;
  --lime:#CFF25A; --sky:#9CC8FF; --tomato:#FF6B4A; --pink:#FFC2E0; --yellow:#FFD84D;
  --pos:#1E7A3C; --neg:#C2361A; --inv:#121212; --oninv:#FFFFFF; --onc:#121212;
  --scrim:rgba(18,18,18,.55);
  /* category palette — never lime / yellow / tomato (reserved for budget health) */
  --p0:#8EE3D0; --p1:#FFC2E0; --p2:#9CC8FF; --p3:#C9B8FF; --p4:#FFB27A;
  --p5:#F2A6E8; --p6:#B8C4D6; --p7:#D9C3A5; --p8:#D9D9D9; --p9:#7FD6F0;
  --font:'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
}
[data-style="dark"] {
  --bg:#111111; --card:#1C1C1C; --ink:#F2F2F2; --line:#F2F2F2; --shadow:#F2F2F2;
  --muted:#B8B8B8; --soft:#2A2A2A; --rule:#2E2E2E;
  --lime:#CFF25A; --sky:#9CC8FF; --tomato:#FF7A5C; --pink:#FFC2E0; --yellow:#FFD84D;
  --pos:#9BE38F; --neg:#FF9A80; --inv:#CFF25A; --oninv:#121212; --onc:#121212;
  --scrim:rgba(0,0,0,.7); color-scheme:dark;
}
[data-style="mono"] {
  --bg:#EFEFEF; --card:#FFFFFF; --ink:#111111; --line:#111111; --shadow:#111111;
  --muted:#4D4D4D; --soft:#F6F6F6; --rule:#E3E3E3;
  --lime:#D9D9D9; --sky:#ECECEC; --tomato:#8A8A8A; --pink:#C4C4C4; --yellow:#B0B0B0;
  --pos:#111111; --neg:#111111; --inv:#111111; --oninv:#FFFFFF; --onc:#111111;
  --p0:#D0D0D0; --p1:#EAEAEA; --p2:#B8B8B8; --p3:#9E9E9E; --p4:#DDDDDD;
  --p5:#C4C4C4; --p6:#F2F2F2; --p7:#ABABAB; --p8:#E0E0E0; --p9:#CCCCCC;
}
```

**Legacy variable aliases.** The current JSX uses CSS variables in inline styles (`var(--accent)`, `--green`, `--red`, `--text`, `--muted`, `--faint`, `--topup`, `--font-ui`, `--font-num`, `--font-lg`, `--font-sm`). Grep for them. Either update each usage or alias them once:

```css
:root { --text:var(--ink); --green:var(--pos); --red:var(--neg); --accent:var(--tomato);
        --faint:var(--card); --topup:var(--pink); --font-ui:var(--font); --font-num:var(--font); }
```

Text on any coloured fill (lime, sky, tomato, yellow, pink, palette) is always `#121212` in every theme.

## 2. Type

- One family: **Bricolage Grotesque** (Google Fonts, weights 400–800, `opsz` axis). Remove the serif and mono faces.
- Page title: `clamp(46px, 8vw, 88px)`, weight 800, line-height .9, letter-spacing −0.05em.
- Section title: 22px / 800 / −0.02em. Labels: 13px / 700. Body: 15px.
- Big numbers: weight 800, `font-variant-numeric: tabular-nums`, letter-spacing −0.02 to −0.03em. Stat tiles `clamp(36px, 4.4vw, 52px)`.

## 3. Shape language

- Borders: **2px solid var(--line)** on cards, chips, buttons, inputs, bars.
- Radius: cards 18px (16px on phones), inputs 12px, pills/buttons/chips 999px, modals 22px.
- Shadow: hard offset `4px 4px 0 var(--shadow)` on cards, `3px 3px 0` on buttons. No blur shadows, no gradients.
- Button hover: translate(−1px,−1px) + 4px shadow. Active: translate(2px,2px) + 1px shadow.
- Focus: `outline: 3px solid var(--sky); outline-offset: 2px`.

## 4. Colour meaning

| Colour | Means |
|---|---|
| lime | under budget, money in, active segment, Spent today tile |
| yellow | near budget (≥80%), day headers, orange spend signal |
| tomato | over budget (>100%), money out, primary "Add" CTA, red spend signal |
| sky | Transfer button, account button, Daily average tile, focus ring |
| pink | Savings account dot |
| `--inv` | active nav pill, table header, Net worth tile, tooltips, toast |
| `--p0…p9` | categories only |

**Category colour rule:** `index of category in that account's list` → `--p{index % 10}` for outgoing; incoming uses `--p{(index + 6) % 10}`. Transfers (`transfer-in`/`transfer-out`) use a dashed chip on `--card`. Replace the existing `colorFor()` palette with this.

## 5. Components (CSS classes in the prototype)

| Prototype class | What it is | Replaces in app |
|---|---|---|
| `.blk` | bordered card with offset shadow | `.card`, `.balance-card`, `.table-card` |
| `.btn` + `.b-tomato/.b-sky/.b-lime` | pill buttons; `.ghost`, `.ink`, `.danger` (dashed red text), `.black` (destructive confirm) | `.btn`, `.btn-secondary`, `.btn-ghost`, `.btn-danger` |
| `.seg` | segmented control, active = lime | `.pill-group` / `.pill-btn` |
| `.chip` | category / status pill | `.pill-tag`, category cells |
| `.ms` | month switcher: activity dot, prev, `<input type=month>`, next; caption below | `.month-switcher*` |
| `.stat` | big-number tile | today grid tiles |
| `.track` + `<i>` | budget progress (health colour fill, 2px right edge) | `.cat-bar-track/fill` |
| `.hbar` | Top spending bar with label inside | top-spending rows |
| `.act` + `.badge` | activity row with round initial badge | `.activity-row` |
| `.chart .bar .tip` | daily bars; dashed budget line; tooltip on hover/focus | `.bar-chart*` |
| `.donut` | conic-gradient ring + legend respecting Cash/%/Both | Money out/in |
| `.vbars` | In vs. out | in-vs-out |
| `.tr` grid rows | transactions table: `.hd`, `.tx`, `.xfer` (diagonal hatch), `.tot`, `.sub`, `.edit` (sky) | `table`, `.txn-row*`, `.day-total-row` |
| `.sig` | spend-signal dot (yellow > orange threshold, tomato > red) | `.spend-warning-dot` |
| `.scrim` + `.modal` | dialog; becomes bottom sheet on phones | `.modal-overlay` / `.modal-panel` |
| `.menu` / `.mitem` | account menu | account switcher dropdown |
| `.warn` | irreversible-action box | `.clear-history-warning` |

## 6. Pages

**Header:** one bordered bar. Wordmark (lime dot + "ledger"), nav pills (active = `--inv`), Style segmented control, account pill (sky, name + black "guest" tag + chevron).

**Overview:** title row with Add transaction (tomato) → date + editable "Budget $X/day" chip → 4 stat tiles (Spent today lime with meter, Daily average sky, Busiest day, Projected month) → Budget card (legend chips, two summary boxes, 2-column category rows) → 3 balance cards (Net worth inverted) → Top spending / Recent activity side by side → Breakdown heading with controls → Monthly insights (in lime, out tomato, net) + daily bar chart → Money out / Money in donuts → In vs. out.

**Transactions:** title + action pills (Transaction, Transfer, Export, Manage categories, divider, dashed Clear all history) → filter card (month switcher + Jump to earliest; Account segmented) → Spend signals chips (dashed, editable) + balances strip → year heading → table card with yellow day chips, day totals, per-account sub-totals.

**Budget:** title + Manage categories + month switcher → Category budgets card (Total budgeted in lime box; Copy from / Clear with inline confirm; 2-column rows with chip, "$x of $y", health pill %, bar, `$`-prefixed input).

**Login:** split screen; left lime panel with wordmark, decorative tilted tiles, tagline; right card with Log in/Sign up segmented, fields, tomato submit, "or", sky Use as guest, guest note.

**Modals:** see prototype. New transaction has a big amount field tinted tomato (out) / lime (in).

## 7. Phone (≤ 760px)

- Header collapses to wordmark + round sky account button. Nav and Style move: nav → fixed bottom tab bar (Overview, Transactions, Budget + round tomato "+" FAB, respecting `env(safe-area-inset-bottom)`); Style + account actions → bottom sheet from the account button.
- Page-level "Add transaction" buttons hide (FAB replaces them).
- Modals become bottom sheets (top radius 26px, grab handle, max-height 92%).
- Transactions table becomes one card per day: yellow header with day totals, rows with badge / note / category · account / amount + running balance; tap a row to reveal Edit / Delete; edit opens inline in the card.
- Chart height 160px, donuts 170px.

## 8. Presentation changes to confirm with me

These are UI changes only. They feed the same handlers and values, but say so in the PR:
1. Direction and Account in the New transaction form are segmented controls, not `<select>`s.
2. Category in that form is a tap-to-pick chip row, not a `<select>`.
3. Phone bottom tab bar + account sheet (replaces stacked header).
4. Phone transaction cards with tap-to-reveal actions (replaces the wide table on phones).

## 9. Suggested order

1. Tokens + font + aliases; confirm all three styles switch.
2. Shared primitives (`.blk`, buttons, seg, chip, inputs, month switcher, modal).
3. Header + phone tab bar/sheet.
4. Overview → Transactions → Budget → Login → modals.
5. Pass at 390px and 1280px in each style; check text contrast on coloured fills.
