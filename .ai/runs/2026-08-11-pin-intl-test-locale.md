# Pin the locale in Intl-formatted unit test assertions

- **Issue:** [#5105](https://github.com/open-mercato/open-mercato/issues/5105)
- **Branch:** `fix/issue-5105-pin-intl-test-locale`
- **Base:** `develop`
- **Skill:** `om-auto-fix-issue`

## Goal

Nine unit tests assert on `Intl`-formatted output without pinning a locale, so `yarn test` is red
for any contributor whose machine default locale is not English. Make the assertions correct —
pin the locale explicitly per test — rather than masking the problem with a global runner setting.

## Reproduction (before the fix)

Run in an isolated worktree on `upstream/develop`:

| Suite | Failures under `LC_ALL=pl_PL.UTF-8` |
|---|---|
| `packages/ui/src/utils/__tests__/format.test.ts` | 1 — `"1234,50 USD"` vs `/1,234\.5/` |
| `packages/core/src/modules/dashboards/lib/__tests__/formatters.test.ts` | 3 — `"1,0 mln"`, `"1,0 tys."`, `"-1,0 mln"` |
| `packages/core/src/modules/customers/components/detail/__tests__/CompanyKpiBar.dealStatus.test.tsx` | 4 — `PLN 1,000` / `PLN 1,700` / `PLN 0` not rendered |
| `packages/core/src/modules/customers/components/__tests__/DealsKpiStrip.test.tsx` | 1 — `1K` not rendered |

All nine pass under `LC_ALL=en_US.UTF-8`.

A repo-wide sweep (every package's jest suite run under `pl_PL.UTF-8` and `en_US.UTF-8`, results
diffed) found a **tenth** case the issue did not list, in a package the reporter had not run:

| Suite | Failures under `LC_ALL=pl_PL.UTF-8` |
|---|---|
| `packages/core/src/modules/sales/components/documents/__tests__/ItemsSection.discountColumn.test.tsx` | 2 — `−4,50 USD` / `−15,00 USD` not rendered |

Its `money()` helper built `new Intl.NumberFormat(undefined, …)`, so outside en-US it produced a
string containing a non-breaking space that never matched the normalized DOM text. Acceptance
criterion 3 (`yarn test` green under a non-English locale) cannot hold without it, so it is fixed
here too. No other package showed a locale-dependent difference.

## Root cause

Two distinct shapes:

1. **Pure formatters that cannot be pinned.** `packages/ui/src/utils/format.ts` hardcodes
   `new Intl.NumberFormat(undefined, …)` and `toLocaleDateString(undefined, …)` — the caller has
   no way to choose a locale, so the assertion is inherently environment-dependent.
   `packages/core/src/modules/customers/components/detail/utils.ts` has the same shape.
2. **Components that know the app locale but ignore it when formatting.** `DealsKpiStrip` already
   calls `useLocale()` for `Intl.PluralRules`, yet builds its compact number formatter from a
   module-level `new Intl.NumberFormat(undefined, …)`. `CompanyKpiBar` formats through
   `detail/utils.formatCurrency`, which is equally locale-blind. The dashboards widgets already do
   this correctly — they thread `useLocale()` into `createCurrencyFormatters(currency, fallback, locale)`
   — so these two components are the outliers, and their rendered numbers currently follow the
   browser/OS locale rather than the app locale.

`packages/core/src/modules/dashboards/lib/formatters.ts` already accepts a `locale`; the tests just
never passed one.

## Approach

Make the locale injectable, thread the app locale where the component already has it, and pin the
locale per assertion. No assertion is weakened, and nothing is pinned in the global jest config.

## Progress

- [x] Reproduce all nine failures under `LC_ALL=pl_PL.UTF-8` on `upstream/develop`
- [x] Claim the issue (assignee + `in-progress` + claim comment)
- [x] `packages/ui/src/utils/format.ts` — accept an optional `locale` on `formatCurrency`/`formatDate`
- [x] `packages/ui/src/ai/records/{DealCard,ProductCard,ActivityCard}.tsx` — pass `useLocale()`
- [x] `packages/core/src/modules/customers/components/detail/utils.ts` — accept an optional `locale`
- [x] `packages/core/src/modules/customers/components/detail/CompanyKpiBar.tsx` — pass `useLocale()`
- [x] `packages/core/src/modules/customers/components/DealsKpiStrip.tsx` — locale-aware compact formatter
- [x] Pin the locale in all four test suites, adding non-English cases as regression guards
- [x] Sweep every package under `pl_PL.UTF-8` vs `en_US.UTF-8` to find cases the issue missed
- [x] `sales/components/documents/lineItemUtils.ts` — `formatMoney` takes an optional `locale`
- [x] `sales/components/documents/ItemsSection.tsx` — pass `useLocale()`; pin it in both ItemsSection suites
- [x] Verify green under both `LC_ALL=pl_PL.UTF-8` and `LC_ALL=en_US.UTF-8`
- [x] Run the configured validation gate
- [x] Open the PR, apply labels, post the summary comment

### Resume — close the UI QA finding

`om-auto-qa-pr` drove the PR head in a browser and found the sales document page still mixing
conventions: the items table rendered `528,00 USD` under a Polish app locale while the summary
panel directly below it rendered `$765.46`, and both dates stayed en-US. Commit `387d9b5` set out
to end exactly that on this page but covered only the sections and dialogs, not the totals panel
(`DocumentTotals` → `PriceWithCurrency`) or the page's own date/message formatting. Evidence:
PR comment `#issuecomment-5251581400`.

- [x] `sales/components/PriceWithCurrency.tsx` — `formatPriceWithCurrency` takes an optional
      `locale`; the component reads `useLocale()` so every call site (DocumentTotals,
      AdjustmentsSection) is covered without touching them
- [x] `sales/backend/sales/documents/[id]/page.tsx` — `locale` for both `toLocaleDateString()`
      displays (expected delivery, placed-at) and for `formatMessageAmount`
- [x] `salesComponentsRender.test.tsx` — extend the `i18n/context` mock with `useLocale` (third
      instance of the same trap) and add a `pl-PL` regression case
- [x] Verify the sales module green under both `pl_PL.UTF-8` and `en_US.UTF-8`
- [x] Run the configured validation gate
- [x] Update the PR body and post the resume summary comment

Re-driven in a browser on the fixed head (`f52f01bf`): the sales document page under a Polish
application locale now reads `95,00 USD` in the items table, `RAZEM (NETTO) 549,90 USD` /
`DO ZAPŁATY 549,90 USD` in the summary panel, and `7.08.2026` / `12.08.2026` for the dates. The
assertion is stated as an absence — no `$1,234.56`-shaped string may survive anywhere on that
page — so a future regression fails loudly instead of merely looking plausible.

### Resume — close the strict-review Medium (timezone-dependent date assertion)

@haxiorz's strict review of head `1920268` raised one Medium: pinning the *locale* left the date
assertions pinned to an *instant*, so they still varied with the runner's `TZ`. The suite this PR
exists to make environment-independent therefore still failed at the extremes —
`2026-06-09T10:00:00.000Z` renders as June 10 under `Pacific/Kiritimati` (UTC+14) and June 8 under
`Etc/GMT+12`, while the assertion said June 9. Evidence: PR comment `#issuecomment-5270691297`.

The fix is the one the reviewer asked for: feed the formatters a date-time literal **without an
offset** (`2026-06-09T12:00:00`), which ECMAScript parses as local time, so it lands on the same
calendar day in every timezone. Midday keeps it clear of any DST transition.

- [x] `sales/components/documents/__tests__/documentLocaleFormatting.test.ts` — replace the
      instant with a local `LOCAL_MIDDAY` constant, with a comment naming both failing zones
- [x] `ui/src/utils/__tests__/format.test.ts` — same treatment for the last remaining
      instant-based date assertions; the day-agnostic regexes (`/^Jun \d{1,2}, 2026$/`,
      `/^\d{1,2} cze 2026$/`) tighten to exact strings now that the day is stable
- [x] Reproduce the reported failure and prove the fix with direct `Intl` probes in five zones
- [x] Re-run every test suite this PR touches under both `Pacific/Kiritimati` and `Etc/GMT+12`
- [x] Reply to the review comment and post the resume summary

Direct `Intl` probe, old input vs new, `dateStyle: 'medium'`:

| TZ | old `…T10:00:00.000Z` | new `…T12:00:00` |
|---|---|---|
| `Pacific/Kiritimati` (UTC+14) | `10 cze 2026` / `Jun 10, 2026` ❌ | `9 cze 2026` / `Jun 9, 2026` ✅ |
| `Etc/GMT+12` (UTC−12) | `8 cze 2026` / `Jun 8, 2026` ❌ | `9 cze 2026` / `Jun 9, 2026` ✅ |
| `UTC`, `Europe/Warsaw`, `America/Los_Angeles` | `9 cze 2026` / `Jun 9, 2026` ✅ | `9 cze 2026` / `Jun 9, 2026` ✅ |

### Resume — close the review findings on `eafd1e99`, then the one on `290e71e0`

`om-auto-fix-pr` closed @pkarw's review of `eafd1e99` (two blockers, one major, two minors, one nit)
on head `290e71e0`; the re-review of that head confirmed all six closed and CI green at 28 checks,
but the sweep found one new Medium introduced *by* the minor-4 fix. Evidence: the re-review at
`#issuecomment-5385...` and the hand-back comment on PR #5182.

- [x] Merge `origin/develop` and resolve the `.ai/lessons.md` catalog-count conflict (`137 → 138`) — fe1c2659c
- [x] `sales/components/documents/ShipmentsSection.tsx` — optional `locale` + `useLocale()`, with the
      returns-shaped cases and a cross-check that the two tabs agree — 290e71e08
- [x] `sales/components/PriceWithCurrency.tsx` — `useOptionalLocale()` so the exported component keeps
      its mountable-anywhere contract; `PriceWithCurrency.providerOptional.test.tsx` guards both halves — 290e71e08
- [x] `customers/components/detail/DealsSection.tsx` — thread `locale` into `formatValueLabel` — 290e71e08
- [x] `customers/components/detail/utils.ts` — `formatDate` takes an optional trailing `locale` — 7dd9b7a08
- [x] `customers/components/detail/DealsSection.tsx:973` — pass `locale` into the expected-close date so
      the card's value and date stop rendering two `<dd>` rows apart in different conventions — 7dd9b7a08
- [x] `DealsSection.test.tsx` — a `pl-PL` expected-close assertion beside the value-label one — 7dd9b7a08
- [x] Verify the customers module green under both `pl_PL.UTF-8` and `en_US.UTF-8` — 234/234 suites, 1472/1472 tests in each
- [x] Re-merge `origin/develop` after it advanced mid-run — c405710a6
- [x] `sales/components/documents/LineItemDialog.tsx:2063` — the read-only price of a shipped line
      was the one `formatMoney` call in that file left without a locale; found by the
      `LineItemDialog.shippedLineLock` suite develop added after the first merge — f92a237fa
- [x] `LineItemDialog.shippedLineLock.test.tsx` — extend the `i18n/context` mock with `useLocale`
      (fourth instance of the same trap) and pin the locale in its two `formatMoney` expectations — f92a237fa
- [ ] Run the configured validation gate
- [ ] Post the resume summary comment and normalize labels

The Medium is worth fixing rather than deferring for the same reason minor 4 was: before this PR the
deal card was self-consistent (value and date both on the runtime locale), and threading the locale
into only one of them made a single card mix conventions — a tighter instance of the exact defect
this PR exists to remove. `formatDate` lives in `utils.ts`, a file this PR already edits, and its
sibling `formatCurrency` ten lines down received precisely this treatment here.

## Notes / follow-ups

- `detail/utils.formatCurrency` still has four call sites (`ActiveDealCard`, `ActiveDealWidget`,
  `DealsLocationPanel`, `DealsMapCanvasImpl`) and `sales`' `formatMoney` three
  (`SalesOrderDraftLines` and the two notification renderers) that format without a locale.
  They are behaviour-unchanged here (the parameter is optional) and are worth a separate follow-up
  so the whole customers surface honours the app locale. UI QA showed what the deferral costs: on a
  company page under a Polish locale the KPI tile reads `210 000 USD` directly above a deal card
  reading `$210,000.00`.
- Threading `useLocale()` into a widely-rendered component breaks any test whose `i18n/context`
  mock only stubs `useT`. Three suites in this PR hit it (`ItemsSection.description`,
  `ShipmentDialog.reRenderLoop`, `salesComponentsRender`). Expect it for every call site above.
- Pre-existing local failures unrelated to this change, reproduced in **both** locales and in
  packages this diff does not touch: `packages/cli` `generateOpenApi` cache tests (flaky, 2 vs 4
  failures across runs), `@open-mercato/telemetry` pg-instrumentation (spawns a child process),
  and `create-mercato-app` harness tests (40 s event-loop timeouts).
