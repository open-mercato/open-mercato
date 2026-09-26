---
title: "Tests asserting `Intl` output must pin the locale and the calendar date"
modules: ["platform"]
areas: ["testing","debugging","backend-ui"]
topics: ["testing","i18n","ui-components"]
---

# Tests asserting `Intl` output must pin the locale and the calendar date

**Context**: `yarn test` was red on a contributor machine whose default locale is Polish because nine assertions compared `Intl`-formatted money and dates against en-US output. Pinning an explicit locale in every assertion fixed the locale half; a later strict review found the date half was still environment-dependent.

**Problem**: A date assertion built from an instant (`2026-06-09T10:00:00.000Z`) formats to a different calendar day depending on the runner's `TZ` — June 10 under `Pacific/Kiritimati` (UTC+14), June 8 under `Etc/GMT+12`. The suite intended to remove machine dependence still failed at the timezone extremes, and the usual workaround (loosening the assertion to a day-agnostic regex) hides the day rather than pinning it.

**Rule**: A test that asserts formatted output must pin **both** axes. Pass an explicit locale to every `Intl.*` / `toLocale*` call under test — never rely on the runtime default — and feed date formatters a date-time literal **without** an offset (`'2026-06-09T12:00:00'`), which ECMAScript parses as local time so it lands on the same calendar day in every timezone. Use midday to stay clear of DST transitions, and keep the assertion exact instead of relaxing it to a regex.

**Corollary — pin a locale the runner does not default to.** Pinning satisfies the rule but does not make the assertion bite: CI resolves `C.UTF-8` to an en-US ICU default, so a suite pinned to `en-US` compares an en-US expectation against an en-US render whether or not the component threads the locale at all, and a revert of the threading stays green. Pin a locale whose output differs (`pl-PL` → `110,70 USD` vs `$110.70`), then prove it by reverting the production line and watching the case fail on the runner CI actually uses.

**Corollary — an Arabic/`ar-SA` assertion has two more axes.** Numbers in `ar-SA` render in the Arabic-Indic system (`١٤٤٧`, not `1447`), and the formatter inserts directional marks (`U+200F`) *between* date segments, so a raw string is `"31‏/01‏/2026"` while the visible text is `"31/01/2026"`. Assert on the mark-stripped string (`value.replace(/[\u200e\u200f\u061c]/g, '')`) and expect the Arabic-Indic digits when the locale implies them — an assertion written for Latin digits silently passes only while the locale is wrong. Non-Islamic calendars are a third: an Umm al-Qura date is only stable for a pinned instant, so anchor the case on a dated instant plus a known boundary (the Hijri New Year) rather than "today".

**Applies to**: `packages/ui/src/utils/__tests__/format.test.ts`, `packages/core/src/modules/sales/components/documents/__tests__/documentLocaleFormatting.test.ts`, `apps/mercato/src/modules/saudi_localization/lib/__tests__/hijri.test.ts`, and any unit test asserting money, date, percent, or compact-number output. Verify with `TZ=Pacific/Kiritimati` and `TZ=Etc/GMT+12`, and with `LC_ALL=pl_PL.UTF-8` alongside `LC_ALL=en_US.UTF-8`.
