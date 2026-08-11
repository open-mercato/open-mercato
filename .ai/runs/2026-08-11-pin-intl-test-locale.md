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
- [x] Verify green under both `LC_ALL=pl_PL.UTF-8` and `LC_ALL=en_US.UTF-8`
- [x] Run the configured validation gate
- [x] Open the PR, apply labels, post the summary comment

## Notes / follow-ups

- `detail/utils.formatCurrency` has four other call sites (`ActiveDealCard`, `ActiveDealWidget`,
  `DealsLocationPanel`, `DealsMapCanvasImpl`) that still format without a locale. They are
  behaviour-unchanged here (the parameter is optional) and are worth a separate follow-up so the
  whole customers surface honours the app locale.
