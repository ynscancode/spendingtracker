# Team Board — Master Archive Index

Master registry for the archived team board. The Engineering Director queries **this file first** to
locate past work — never by scanning shards. Lower agents don't read it.

**How to use (retrieval funnel):**
1. **Recall (deterministic):** `grep` this file by keyword, or filter by `Category`/`Tags`. One row per slug, so grep is line-oriented.
2. **Precision (semantic):** read only the `Resolution summary` of the candidate rows and pick by *meaning* — this resolves keyword collisions (same word, different context) without opening any shard.
3. **Extract:** from the chosen row's `Shard`, run `sed -n '/<!-- <slug>:START -->/,/<!-- <slug>:END -->/p' <shard-file>` to read just that section.
4. **Phrasing-drift fallback:** if keywords miss because old wording differs, filter by `Category` and read every row in that bucket — the category survives vocabulary drift.

Each entry is registered once, at archive time, by the Engineering Director. Slugs are permanent and never
reused. `Shard` is the archive file holding the full history; the section there is bracketed by
`<!-- <slug>:START -->` / `<!-- <slug>:END -->` markers.

**Legacy format note:** `ARCH-0001`–`ARCH-0017` were archived before the mandatory entry format (2026-07-15);
their shard sections are in the original freeform style, preserved verbatim (see the shard preamble). Batches
from 2026-07-15 onward use the `### [ROLE-YYYYMMDDTHHMMSS]` + five-field format. This note only concerns the
*prose style inside* a section — the index rows and slug/marker structure are uniform across all entries.

| Slug | Category | Shard | Heading | Resolution summary | Tags |
|---|---|---|---|---|---|
| ARCH-0001 | export | 001 | MonthSwitcher width fix + Import→Export swap | MonthSwitcher row stretched to its activity-caption width and misaligned the account pills; fixed to a caption-independent fixed width, and the Import entry point was removed in favor of a new xlsx export endpoint + ExportModal. | monthswitcher, filter-strip, layout, alignment, import, export, xlsx, exportmodal, buildtransactionsworkbook |
| ARCH-0002 | export | 001 | Follow-up: layout refinements + export fixes | Follow-up polish to the ARCH-0001 MonthSwitcher alignment plus corrections to the new export flow. | layout, alignment, export, follow-up |
| ARCH-0003 | export | 001 | Follow-up: export download bug + export UX | Export download misbehaved and the flow was awkward; fixed the download trigger and export UX, and removed dead blob code from client.js. | export, download, ux, client.js, bugfix |
| ARCH-0004 | export | 001 | Follow-up: export cell formatting | Exported xlsx wasn't cleanly formatted; added auto-fit column widths and split output into separate Spending/Savings sheets. | export, xlsx, formatting, column-width, sheets, sheetjs |
| ARCH-0005 | export | 001 | Follow-up: month separators in all-time export | The all-time export ran months together with no visual break; added month-separator rows (no cell merging) while leaving single-month export byte-identical. | export, xlsx, all-time, month-separator, formatting |
| ARCH-0006 | categories | 001 | Follow-up: in/out labels + standalone Manage Categories | Added explicit In/Out labels on transactions and a standalone "Manage Categories" entry point. | in-out-label, transactions, categories, manage-categories, ui |
| ARCH-0007 | transactions | 001 | Follow-up: per-day money-in excludes transfers | The per-day "money in" subtotal wrongly counted internal transfer-in legs; fixed so day money-in counts only real (non-transfer) income. | transactions, day-totals, money-in, transfers, dayTotals.js |
| ARCH-0008 | budget | 001 | Follow-up: total-budgeted figure on Budget tab | The Budget tab showed no aggregate; added a "Total budgeted" figure. | budget, total-budgeted, budget-tab, ui |
| ARCH-0009 | ui-layout | 001 | Mobile layout fix: Overview overflow + Budget card collision | On mobile the Overview overflowed and the Budget card collided with adjacent content; fixed with responsive layout adjustments. | mobile, responsive, overview, budget-card, overflow, layout |
| ARCH-0010 | ui-layout | 001 | Follow-up: hard day dividers on Transactions | Days on the Transactions list ran together; added hard day-divider rules between day groups. | transactions, day-divider, layout, ui |
| ARCH-0011 | deployment | 001 | Deploy app online (free hosting) — initial attempt | First attempt to deploy the app on free hosting; later re-targeted (see ARCH-0012) and ultimately superseded (see ARCH-0013). | deploy, hosting, free-tier, initial |
| ARCH-0012 | deployment | 001 | Re-target deployment to Google Cloud free tier | Re-pointed the deployment plan to a Google Cloud free-tier VM; later superseded by the serverless migration (see ARCH-0013). | deploy, gcloud, google-cloud, vm, free-tier, superseded |
| ARCH-0013 | deployment | 001 | Backend → Vercel serverless + Turso (libSQL) migration | Single-VM hosting didn't fit the serverless target, so the Express/better-sqlite3 backend was migrated to Vercel serverless functions + Turso (libSQL); supersedes ARCH-0012. | deploy, vercel, serverless, turso, libsql, backend, migration, tech-lead-contract |
| ARCH-0014 | ui-layout | 001 | Mobile responsive layout (@media max-width:768px) | Added a mobile responsive layout via an `@media (max-width:768px)` block. | mobile, responsive, media-query, layout, css |
| ARCH-0015 | ui-layout | 001 | Mobile fix: Monthly-insights wrap + bar-chart tooltip clip | On mobile the Monthly-insights row wrapped badly and the bar-chart tooltip was clipped; fixed the wrap and tooltip overflow. | mobile, monthly-insights, bar-chart, tooltip, clip, overflow, layout |
| ARCH-0016 | bugfix-date | 001 | UTC-vs-local date bug (todayStr/currentMonthStr) | `todayStr`/`currentMonthStr` computed in UTC and showed the wrong local calendar date/month; fixed to compute the local date. | date, timezone, utc, local, todayStr, currentMonthStr, bugfix |
| ARCH-0017 | auth | 001 | User auth: accounts + per-user data isolation | Added user accounts with per-user isolation: HS256 JWT (no expiry), users table (migrations 006–009), `user_id` stamped on transactions/budgets/categories with service-layer scoping, and a first-signup legacy-claim; includes the tech-lead auth contract. | auth, users, jwt, bcrypt, user_id, isolation, migrations, signup, login, guest, tech-lead-contract |
| ARCH-0018 | dashboard | 001 | Dashboard Breakdown view switch (Combined/Spending/Savings) + Combined Monthly insights | Per-account Breakdown donuts excluded transfers so neither account reconciled with its balance change (income lands in Savings, funds Spending via transfer); added Combined/Spending/Savings switch — Combined = non-transfer flows across both accounts (name-collision suffix), per-account views include gray From/To transfer segments so in−out = balance delta; Monthly insights moved to Combined (daily bars stay Spending-only); a 769–860px heading-row overflow from the third control was fixed via base flex-wrap. | dashboard, breakdown, donut, transfers, reconciliation, savings-rate, monthly-insights, radiogroup, BreakdownViewSwitch, utils/breakdown.js, flex-wrap, overflow, breakpoint-band |
