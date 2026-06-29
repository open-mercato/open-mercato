# Date And Locale Settings

## TLDR

Open Mercato has several date and locale formatting paths: i18n locale detection, `DatePicker` locale-derived display formats, `DataTable`'s `NEXT_PUBLIC_DATE_FORMAT`, dashboard widgets using `Intl`, and module-local `date-fns` formatting. The immediate CI fix keeps `date-fns` as the shared formatting dependency and makes standalone apps install it directly. This spec tracks the follow-up: one system-wide settings contract for locale, date, date-time, time, timezone, and first-day-of-week defaults, with environment-variable bootstrap and an admin settings UI.

## Open Questions

Q1. Should tenant settings override environment defaults, or should environment variables remain hard overrides in production?
Q2. Should user profile locale/date preferences override tenant defaults in the first implementation, or be deferred?
Q3. Should date/time patterns use `date-fns` tokens only, or should the settings UI store `Intl.DateTimeFormatOptions` presets instead of free-form patterns?

## Problem Statement

Date formatting is currently fragmented:

- `packages/ui/src/backend/DataTable.tsx` reads `NEXT_PUBLIC_DATE_FORMAT` and applies a local formatter.
- `packages/ui/src/primitives/date-picker.tsx` and `date-range-picker.tsx` derive display formats from a local day-first locale list.
- CRM schedule forms use `date-fns` for internal ISO date/time input seed values.
- Dashboard widgets and some module pages call `Date#toLocaleString()` directly.
- Standalone generated apps did not install `date-fns` directly even though package exports expose raw TypeScript sources that import it during app typechecking.

This creates two failure modes: standalone type-resolution drift, and inconsistent date/locale output across pages.

## Proposed Solution

Create a shared localization settings contract with three layers:

1. **Environment defaults** for deployment-wide bootstrap:
   - `NEXT_PUBLIC_OM_DATE_FORMAT`
   - `NEXT_PUBLIC_OM_DATE_TIME_FORMAT`
   - `NEXT_PUBLIC_OM_TIME_FORMAT`
   - `OM_DEFAULT_LOCALE`
   - `OM_DEFAULT_TIMEZONE`
   - `OM_FIRST_DAY_OF_WEEK`
2. **Tenant/system settings** persisted through the existing settings/configs surface, editable by admins.
3. **User profile override** for locale and display preferences, when explicitly enabled.

Unset env values, and values such as `system` / `auto`, should fall back to locale-derived defaults.

## Architecture Notes

- Keep internal HTML date input values in ISO `yyyy-MM-dd`; only display labels should use configurable formats.
- Use `date-fns` tokens for free-form pattern support unless the final design switches to `Intl` presets.
- Centralize helpers in a shared UI formatting module instead of repeating day-first locale lists.
- Preserve `NEXT_PUBLIC_DATE_FORMAT` as a backwards-compatible alias for existing apps.
- Avoid database migrations in the first audit step; introduce persisted settings only after all consumers are inventoried.

## Phasing

### Phase 1: Dependency And Env Baseline

- Add `date-fns` and `date-fns-tz` to the standalone app template dependencies.
- Add `NEXT_PUBLIC_OM_DATE_FORMAT` and `NEXT_PUBLIC_OM_DATE_TIME_FORMAT` public display-format aliases.
- Keep `NEXT_PUBLIC_DATE_FORMAT` as a legacy alias.
- Add focused UI tests for format resolution.

### Phase 2: Codebase Audit

- Inventory every `date-fns`, `date-fns-tz`, `toLocaleDateString`, `toLocaleString`, `Intl.DateTimeFormat`, and custom formatter use.
- Categorize each call site as internal value formatting, user-visible display, API serialization, or document/export formatting.
- Decide which call sites must remain ISO/stable and which should use user-visible settings.

### Phase 3: Settings Contract

- Define a typed `DateLocaleSettings` payload in shared infrastructure.
- Add read helpers that resolve `user override -> tenant setting -> env default -> locale/system fallback`.
- Add validation for supported locales, timezones, and date/time pattern safety.

### Phase 4: Admin Settings UI

- Add a backend settings page for locale/date defaults using existing backend UI primitives.
- Add preview examples for date, date-time, time, timezone, and first-day-of-week effects.
- Add role/feature gating through existing settings/configuration access patterns.

### Phase 5: Consumer Migration

- Migrate user-visible UI components first: DataTable, DatePicker, DateRangePicker, schedules, dashboards, and document tables.
- Migrate document/export formatting only after BC review because those outputs can be contractual.
- Add integration coverage for settings read paths and representative UI surfaces.

## Integration Coverage

- API/settings path for reading and updating date/locale settings.
- Backend settings UI page smoke test.
- DataTable date column formatting with env fallback and persisted settings fallback.
- DatePicker and DateRangePicker display formatting with locale-derived fallback.
- Standalone app integration build/typecheck with `date-fns` available as a direct dependency.

## Risks And Mitigations

- **Pattern ambiguity:** `YYYY`/`DD` mean different things across formatter libraries. Mitigation: normalize common legacy tokens and validate patterns before saving.
- **HTML input breakage:** date inputs require ISO values. Mitigation: keep input state separate from display formatting.
- **BC drift in exports/documents:** invoice or CSV date formats may be relied on externally. Mitigation: classify document/export formatting separately and migrate only behind explicit settings.
- **Client env leakage:** only public display preferences should use `NEXT_PUBLIC_` variables. Server-only tenant defaults stay behind `OM_` variables and API/settings resolution.

## Final Compliance Report

- No direct ORM relationships proposed.
- Tenant-scoped persisted settings must include tenant/organization scope where applicable.
- API inputs must use zod validation.
- UI work must use existing backend settings and design-system primitives.
- Backward compatibility requires keeping `NEXT_PUBLIC_DATE_FORMAT` as an alias for at least one minor release.

## Changelog

- 2026-05-18: Drafted from PR #1963 CI follow-up. Phase 1 is the immediate dependency/env baseline; Phases 2-5 are tracked as follow-up work.
