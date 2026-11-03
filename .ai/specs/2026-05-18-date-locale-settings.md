# Date And Locale Settings

## TLDR

Open Mercato has several date and locale formatting paths: i18n locale detection, `DatePicker` locale-derived display formats, `DataTable`'s `NEXT_PUBLIC_DATE_FORMAT`, dashboard widgets using `Intl`, and module-local `date-fns` formatting. The immediate CI fix keeps `date-fns` as the shared formatting dependency and makes standalone apps install it directly. This spec tracks the follow-up: one system-wide settings contract for locale, date, date-time, time, timezone, and first-day-of-week defaults, with environment-variable bootstrap and an admin settings UI.

## Resolved Questions

Q1. Should tenant settings override environment defaults, or should environment variables remain hard overrides in production?
**Resolved (2026-11-03):** tenant settings override env. Env variables are bootstrap defaults only. Resolution order per field: `user override -> tenant setting -> env default -> locale/system fallback`.

Q2. Should user profile locale/date preferences override tenant defaults in the first implementation, or be deferred?
**Resolved (2026-11-03):** a user may override the **timezone only**. Locale keeps following the existing i18n locale cookie; date, date-time and time formats and first day of week stay tenant-wide.

Q3. Should date/time patterns use `date-fns` tokens only, or should the settings UI store `Intl.DateTimeFormatOptions` presets instead of free-form patterns?
**Resolved (2026-11-03):** the settings UI offers presets plus a validated custom `date-fns` pattern. `auto` (the default) keeps the locale-derived `Intl` rendering. Stored values are always `date-fns` patterns or `auto`, matching the existing `NEXT_PUBLIC_OM_*` env variables.

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

4. **Database session timezone** (server-only, independent of the display settings):
   - `OM_DB_DEFAULT_TIMEZONE` — optional IANA zone (for example `UTC`, `Europe/Warsaw`). When present, every Postgres connection the platform opens (the MikroORM pool, CLI migrations and raw `pg` clients, the events bridge, pgvector pools, scheduler supervisor) starts with `-c TimeZone=<zone>`. When unset, connections keep the server's default `TimeZone`, exactly as before.
   - The value is validated and canonicalized with `Intl`; an invalid value fails at connection setup with an error naming the variable (Postgres would otherwise reject every connection with `FATAL: invalid value for parameter "TimeZone"`).
   - It affects only SQL that depends on the session zone: `date_trunc` on `timestamptz`, `CURRENT_DATE`, `timestamptz::date` and `?::date` comparisons. All stored instants are `timestamptz` and MikroORM serializes Dates in UTC, so persisted values do not change.

## Data Models

- **Tenant settings:** one JSON blob per tenant in `module_configs` (`module_id = 'configs'`, `name = 'date_locale'`), read and written through `ModuleConfigService`. Shape (`DateLocaleSettingsInput`, every field optional, `auto` or absent means "inherit"):
  ```ts
  { locale?: string; dateFormat?: string; dateTimeFormat?: string; timeFormat?: string; timeZone?: string; firstDayOfWeek?: 0|1|2|3|4|5|6 }
  ```
- **User override:** nullable `timezone text` column on `users` (additive migration). `null` means "use the organization default".

## API Contracts

- `GET /api/configs/date-locale` (`configs.date_locale.view`): `{ settings, effective, sources, envDefaults, updatedAt }` for the caller's tenant.
- `PUT /api/configs/date-locale` (`configs.date_locale.manage`): body `DateLocaleSettingsInput`, zod-validated (IANA zone, safe `date-fns` pattern, `firstDayOfWeek` 0–6). Optimistic locking through the standard `updatedAt` header; stale writes return 409.
- `GET/PUT /api/auth/profile`: gains optional `timezone` (`string | null`).

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

#### Audit results (2026-11-03)

About 400 call sites format dates directly; ten files used the shared helpers. Classification:

- **Display (migrate):** bare `toLocaleString()` / `toLocaleDateString()` across workflows, scheduler, customers, sales, documents, webhooks, sso, data_sync, integrations, forms, messages, eudr, warranty_claims, checkout, currencies, audit_logs, inbox_ops, ai_assistant, staff and wms pages; `DatePicker` / `DateRangePicker` (still on the day-first locale list, forced `HH:mm`); `Calendar` (week start only from the date-fns locale); schedule components (forced 24h); `dateRanges.ts` (hard-coded Monday); dashboard widgets; `formatDistanceToNow` without locale; 15 copies of "browser timezone" and several "today" helpers computed in UTC.
- **Internal values (keep ISO):** `yyyy-MM-dd` / `yyyy-MM-dd'T'HH:mm` input and filter values, `toDateInputValue` / `toUtcDateInputValue`, calendar keys, timezone math helpers (planner, tillio, warranty business hours, customers calendar, currency providers).
- **API serialization (keep ISO):** CRUD responses, AI tools, `crud/exporters.ts`. Exception migrated: `customers/api/interactions/conflicts` returned a server-zone `HH:mm` string.
- **Documents/exports (BC review):** CSV/XLSX exports, `workflows/lib/interpolation-pipeline.ts`, `documents/lib/templateFill.ts` `{{date}}` stay unchanged. Server-rendered user text (quote email "valid until", server-side "today"/week boundaries) moves to the resolved tenant timezone.

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
- **DB session zone shifts reports:** setting `OM_DB_DEFAULT_TIMEZONE` on an existing deployment moves `date_trunc` day/week buckets and `CURRENT_DATE` comparisons to the new zone. Severity medium (dashboards, overdue-deal counts, AI usage day buckets). Mitigation: opt-in, unset keeps current behavior, documented in `.env.example` and troubleshooting docs. Residual: operators must choose the zone deliberately.
- **Invalid DB zone blocks startup:** a typo in `OM_DB_DEFAULT_TIMEZONE` fails every connection. Mitigation: validate before connecting and fail with a message naming the variable. Residual: none beyond a clear startup error.
- **Default rendering change:** moving `DatePicker` / `DateRangePicker` to the `Intl` path changes the default display for some locales (for example `ko` no longer falls back to `MMM d, yyyy`). Mitigation: env and tenant patterns still pin any format. Residual: low, cosmetic.

## Final Compliance Report

- No direct ORM relationships proposed.
- Tenant-scoped persisted settings must include tenant/organization scope where applicable.
- API inputs must use zod validation.
- UI work must use existing backend settings and design-system primitives.
- Backward compatibility requires keeping `NEXT_PUBLIC_DATE_FORMAT` as an alias for at least one minor release.

## Changelog

- 2026-05-18: Drafted from PR #1963 CI follow-up. Phase 1 is the immediate dependency/env baseline; Phases 2-5 are tracked as follow-up work.
- 2026-08-25: Partial Phase 5 for the sales document detail, its Returns / Shipments / Payments tabs, and `DataTable`. `primitives/date-format` gains `formatDisplayDate` / `formatDisplayDateTime` — `Intl`-formatted in the application locale when no env pattern is set, per the fallback rule above — plus `toDateInputValue` / `toUtcDateInputValue` for the two frames a date column can carry. `DataTable` renders through the same helper instead of a fourth inline env chain, so **every backend table moves from the locale-neutral `yyyy-MM-dd HH:mm` to the application locale** — including a 12-hour clock under `en`, the default locale, where `2026-07-01 00:00` becomes `Jul 1, 2026, 12:00 AM`; operators wanting the previous rendering set `NEXT_PUBLIC_OM_DATE_TIME_FORMAT=yyyy-MM-dd HH:mm`. Date inputs stay `yyyy-MM-dd`, as the Architecture Notes require. Not migrated: `DatePicker`, `DateRangePicker`, schedules, dashboards, and the sales documents list (`SalesDocumentsTable`), which still formats its Date column with a bespoke `toLocaleString()` cell. The settings contract itself is untouched — this is env-var only, so Phase 5 stays open.
- 2026-11-03: Resolved Q1–Q3 (tenant overrides env; user override is timezone only; presets plus validated `date-fns` patterns). Added `OM_DB_DEFAULT_TIMEZONE` for the Postgres session `TimeZone`, the Phase 2 audit results, Data Models and API Contracts. Implementation of Phases 3–5 starts on `feat/date-locale-settings`.
- 2026-11-03: Implemented on `feat/date-locale-settings`.
  - **DB:** `OM_DB_DEFAULT_TIMEZONE` via `@open-mercato/shared/lib/db/session` (`getPgSessionConfig`), wired into the ORM pool, CLI, scheduler supervisor, events bridge, pgvector and integration fixtures.
  - **Contract:** `@open-mercato/shared/lib/date-locale` (types, presets, validation, `resolveDateLocaleSettings`), request and scope resolver slots in `.../date-locale/registry`, registered by `configs`. Stored in `module_configs('configs','date_locale')`; `GET/PUT /api/configs/date-locale` (`configs.date_locale.view|manage`, optimistic locking); Settings → System → Date & time page.
  - **User override:** `users.timezone` (migration `Migration20261103120000_auth`), `auth.users.update` + `/api/auth/profile`, Profile → Time zone page.
  - **Client:** `DateLocaleSettingsProvider` in the root layout, plus nested providers in the backend layout (re-rendered on the client-side login redirect, so the signed-in tenant/user settings apply without a reload) and the portal layout (tenant of the organization in the URL); `formatDisplayDate|DateTime|Time`, `formatLocalDisplayValue`, `todayInZone`, `useDisplayTimeZone`, `useWeekStartsOn` in `@open-mercato/ui/primitives`. DatePicker/DateRangePicker use `Intl` by default (no forced 24h); Calendar defaults `weekStartsOn` from settings; schedule views follow the 12/24h setting.
  - **Consumers:** display call sites migrated across customers, sales, catalog, documents, forms, messages, workflows, scheduler, webhooks, staff, wms, eudr, warranty_claims, planner, dashboards, security/SSO, agent orchestrator, AI assistant and smaller modules.
  - **Server:** quote email valid-until in the tenant zone/locale, dashboard week presets use the tenant first day of week, staff my-work names today in the user zone, interaction conflicts return ISO `startsAt`/`endsAt`.
  - **Kept as-is (Group B):** ISO input/filter values, API/AI-tool serialization, CSV/XLSX exports, `workflows/lib/interpolation-pipeline.ts`, `documents/lib/templateFill.ts`, timezone math helpers, AI usage UTC day windows, timesheet Monday-based week periods (aligned with the my-work API).
  - **Deferred:** leave-request notification variables are still formatted server-side; the CRM calendar grid and schedule dialog still lay out in the browser zone; `resolveDateRange` server ranges use the process zone; a per-organization (not per-tenant) setting.
  - **Date-only pin:** when the tenant pins only a date pattern, timestamps use it followed by the time pattern or date-fns' localized short time `p`, so they keep their time. An env-only `NEXT_PUBLIC_OM_DATE_FORMAT` stays bare (unchanged behavior).
  - **First day of week:** resolved as configured day → the configured formatting locale's own week start, from the full regional tag via `Intl.Locale` week info (`en-GB` Monday, `en-US` Sunday, `ar-EG` Saturday) → Monday. The app UI language never decides it, so an unconfigured tenant keeps a Monday week. The settings page shows the effective day and its source (`resolveFirstDayOfWeek` in `@open-mercato/shared/lib/date-locale/weekStart`).
