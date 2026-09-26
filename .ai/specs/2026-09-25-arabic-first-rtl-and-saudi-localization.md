# Arabic-First RTL and Saudi Localization

**Status:** Phase 0 and Phase 1 implemented (2026-09-25); Phase 1b–4 planned
**Scope:** OSS (`packages/shared`, `packages/ui`, `apps/mercato`) + planned app-local modules
**Related:** [`.ai/specs/2026-09-03-extensible-locale-set.md`](2026-09-03-extensible-locale-set.md), [`.ai/specs/2026-05-18-date-locale-settings.md`](2026-05-18-date-locale-settings.md)

## TLDR

The platform can now *serve* an Arabic dictionary (`ar` is registered by the app),
but it renders every page left-to-right: the root layout emits `lang` without
`dir`, no direction helper exists, no calendar is Hijri-aware, and nothing models
Saudi fiscal rules (15% VAT, ZATCA e-invoicing). Phase 0 adds the direction
foundation the rest of the program depends on — a single `getLocaleDirection()`
authority, `<html dir>` in the app shell, and a `direction` value in the i18n
context — and this document scopes the remaining phases so each can be
implemented and reviewed on its own.

## Overview

Target: an ERP that a Saudi company — or a company anywhere in the Arabic-speaking
market, in any sector — can run natively in Arabic, with correct RTL rendering,
Hijri-aware dates, Saudi tax compliance, and Arabic document output.

Today the gap is structural, not cosmetic:

| Capability | State before this spec |
|---|---|
| Arabic UI dictionary | ✅ served (`ar` registered via the locale extension point) |
| RTL document direction | ❌ `<html lang>` only; every layout mirrors LTR |
| Directional layout utilities | ❌ physical Tailwind utilities (`ml-*`, `pl-*`, `left-*`) throughout |
| Direction access in client components | ❌ no context value, no hook |
| Hijri (Umm al-Qura) dates | ❌ nothing |
| Saudi VAT / invoice numbering | ❌ only generic tax placeholders |
| ZATCA e-invoicing (Fatoora) | ❌ nothing |
| Arabic invoice/PDF output | ❌ nothing multilingual in document templates |

## Problem Statement

1. **A dictionary without direction is unusable.** Arabic text renders
   left-to-right: mixed Arabic/Latin lines break, list indentation, sidebars,
   drawers, chevrons, progress and form affordances all point the wrong way.
   Serving `ar` without `dir="rtl"` is worse than not serving it, because the
   locale looks "supported" while the UI is broken.
2. **Direction is re-derived ad hoc.** Because there is no `getLocaleDirection()`,
   each surface that wants to mirror needs its own table of RTL languages — the
   exact drift the extensible-locale-set spec removed for the *locale* set.
3. **Compliance is a hard requirement, not a feature.** ZATCA e-invoicing
   (Phase 1 generation QR since 2021, Phase 2 integration waves) makes an ERP
   without it unusable for any Saudi VAT-registered company, and Hijri dates are
   expected on HR and document output across the region.

## Proposed Solution

### Phase 0 — Direction foundation (implemented here)

1. `packages/shared/src/lib/i18n/direction.ts`: the single runtime authority for
   text direction.
   - `getLocaleDirection(locale)` — normalizes (`ar_SA`, `AR-sa` → `ar-sa`),
     consults app-registered overrides, falls back to a conservative
     right-to-left base-language table, defaults to `ltr`.
   - `isRtlLocale(locale)`.
   - `registerTextDirections({ … })` / `clearRegisteredTextDirections()` —
     the same extension-point shape as `registerLocales()`, so an app can serve
     an Arabic-script language the platform's table does not know, or force a
     Latin-script variant of an ambiguous code.
   - No dependency beyond `./locale-set`, so client bundles can import it.
2. `I18nContextValue.direction` + `useDirection()` in `context.tsx`, so client
   components mirror without reading the DOM. A nested provider derives from its
   own `locale` when no explicit `direction` is passed.
3. Root layout emits `<html lang={locale} dir={direction}>` and forwards
   `direction` to `AppProviders`, which mounts `DocumentDirection` so the
   attribute also follows a client-side locale change. The create-app template
   mirrors every touched file.

### Phase 1 — RTL-safe UI (implemented)

1. **Done.** Directional Tailwind utilities migrated to logical equivalents
   repo-wide: 574 source files, ~2 000 class tokens (`ml-/mr-/pl-/pr-` →
   `ms-/me-/ps-/pe-`, `text-left/right` → `text-start/end`, `left-/right-` →
   `start-/end-`, `border-l/r` → `border-s/e`, `rounded-l/r` → `rounded-s/e`,
   `rounded-tl/tr/bl/br` → `rounded-ss/se/es/ee`, `float-left/right` →
   `float-start/end`). Tailwind v4 resolves these to the same physical edge in
   LTR and mirrors them under `[dir=rtl]`.
2. **Done.** `packages/core/src/__tests__/rtl-safe-utilities.test.ts` fails on any
   physical directional utility in `packages/*/src` or `apps/*/src`, with an
   `rtl-physical` line marker as the reviewable escape hatch; it is registered in
   `scripts/repo-wide-guards.mjs`.
3. **Done.** `.ai/ds-rules.md` gained a Direction (RTL / Arabic) section.
4. **Done for the migration's scope.** The centred-overlay idiom now pairs
   `start-1/2` with `rtl:translate-x-1/2` (19 sites).

### Phase 1b — patterns with no logical equivalent

Not renames, so each is a per-site decision and is deliberately outside the
guard:

1. `bg-gradient-to-l/r` — a physical gradient step. The DataTable sticky-column
   shadows are the canonical case: they need `rtl:bg-gradient-to-l/r` overrides on
   the `before:`/`after:` shadow classes.
2. `space-x-*` (14 sites) and `divide-x` — sibling spacing. Verify against the
   installed Tailwind version whether `space-x-*` already resolves to
   `margin-inline-*`; if not, migrate the call sites.
3. Inline `style={{ left }}` / `style={{ right }}` in canvas and diagram code
   (workflow nodes, run gantt, agent trace timelines, app shell aside width) —
   coordinates are physical by construction; mirroring needs measured-value
   arithmetic, not classes.
4. `origin-left/right`, `bg-left/right` and `translate-x-*` outside the centring
   idiom — audit each occurrence.
5. The primitives that consume direction as data rather than as layout:
   `ScrollArea` (`dir` prop, already supported), chevrons/drag handles,
   `InlineGranularitySelect`, `ScheduleGrid`, chart axis origin, code editor.

### Phase 2 — Arabic content completeness

1. Ship `ar` dictionaries for every module that ships `en` (module-level
   `i18n/ar.json`), and make `i18n:check-sync` aware of the app-extended locale
   set instead of the platform's shipped five. Note the constraint found while
   implementing Phase 0: `registerLocales` validates the base subtag against the
   ISO 639-1 table, so a 639-2/3 code such as `ckb` (Central Kurdish) or `nqo`
   cannot be served today — widen the validation or document the limit.
2. Arabic layout and typography: `dir`-aware font stack (app-level override),
   larger line-height for Arabic ascenders/descenders, and an explicit policy for
   Arabic-Indic versus Western numerals.
3. Locale label coverage for app-registered locales (today `ar` resolves its
   endonym through `Intl.DisplayNames` because `SHIPPED_LOCALE_LABELS` has no
   entry).
4. Locale-aware `Intl` formatting for numbers, currency and dates everywhere a
   value is formatted, including the decimal-input parser.

### Phase 3 — Saudi localization module

A new app-local module `saudi_localization` (working name) owning:

1. **VAT 15%** default tax rate plus registration metadata (VAT number, CR
   number), with rate history so historical invoices keep their rate.
2. **ZATCA Phase 1 QR** — the 5-tag TLV (Base64) payload that must appear on
   simplified tax invoices: seller name, VAT registration number, ISO-8601
   timestamp, invoice total including VAT, VAT total. A pure function, fully
   unit-testable, no network.
3. **ZATCA Phase 2 integration** — UBL 2.1 invoice XML, invoice hash, previous
   invoice hash (PIH), invoice counter value (ICV), cryptographic stamp
   (compliance/production CSID), and the clearance (standard invoices) /
   reporting (simplified invoices) pipeline with retry and an audit-trail
   entity.
4. **Hijri (Umm al-Qura) dates** — `Intl.DateTimeFormat` with
   `islamic-umalqura` for display and document output, dual-calendar fields
   where HR/fiscal documents expect both.
5. **Arabic document output** — RTL-safe PDF/invoice templates with embedded
   Arabic-capable fonts.

### Phase 4 — Sector playbooks

Thin configuration plus documentation per sector (transport/fleet/HR already
exist as app modules; retail, contracting, healthcare and education next), each
as a spec of its own — no core changes.

## Architecture

```
packages/shared/src/lib/i18n/
  config.ts             LocaleRegistry (compile-time locale set)
  locale-set.ts         supported-locale read side (no heavy deps)
  locale-registry.ts    registerLocales() runtime authority
  direction.ts          NEW — text-direction authority (Phase 0)
  context.tsx           I18nProvider / useT / useLocale / useDirection
apps/mercato/src/app/layout.tsx                <html lang dir>
apps/mercato/src/components/AppProviders.tsx   direction → I18nProvider
```

Direction is derived, never stored per entity, and never read back from the DOM:
the server renders `dir` once and client components read `useDirection()`.

## Data Models

Phase 0 introduces no entities.

Phase 3 (design intent, not implemented): `saudi_einvoice_submission`
(`id`, `organization_id`, `tenant_id`, `invoice_id`, `uuid`, `icv`,
`invoice_hash`, `previous_invoice_hash`, `status`, `submitted_at`,
`cleared_at`, `response_jsonb`, timestamps, soft delete). Values are stored as
text to preserve ZATCA's exact serialization, and the QR payload is never
persisted so there is no stale copy of hashed content.

## API Contracts

Phase 0 changes no HTTP API.

Phase 3 (design intent): `POST /api/saudi/zatca/submit`,
`GET /api/saudi/zatca/submissions`, `GET /api/saudi/vat-settings`, guarded by
new ACL features (`saudi_localization.*`) and built on `makeCrudRoute`.

## Integration Coverage

- **Phase 0:** no API path changed. The affected UI path is every page (root
  layout `<html dir>`), covered by unit tests in
  `packages/shared/src/lib/i18n/__tests__/direction.test.ts`,
  `.../context-direction.test.tsx`, and `apps/mercato/src/app/__tests__/layout.test.tsx`
  (asserting `dir="ltr"` for `en` and `dir="rtl"` for `ar`). No Playwright case
  is added because no route, endpoint or interaction is new — the direction
  contract is asserted at the layout boundary instead.
- **Phase 1:** UI-only. Requires Playwright coverage of one backend list, one
  detail form and the portal shell under `ar` (RTL) alongside the existing `en`
  run.
- **Phase 3:** integration tests per endpoint (QR generation unit-tested against
  published TLV fixtures; the submission pipeline tested against a stubbed ZATCA
  API), plus a UI path covering invoice generation and submission status.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Wrong default direction for an ambiguous code (`ku`, `az`) | Medium | i18n | Conservative RTL base list (unambiguous Arabic-script codes only) plus `registerTextDirections()` per-app override | The app must override when its script differs from the default |
| Phase 0 sets `dir` while layouts are still LTR-oriented, so Arabic looks worse before Phase 1 | Medium | UI | Phase 0 is a prerequisite, not a production Arabic claim; Phase 1 adds the guard that stops new physical utilities | Arabic UI is not production-ready until Phase 1 lands |
| ZATCA QR/hash correctness is legally binding | High | Compliance | QR is a pure function tested against published fixtures; submissions persist ZATCA's raw response; no silent fallback on failure | Must be validated against the ZATCA sandbox before any production claim |
| Hijri conversion differences (Umm al-Qura vs astronomical) | Medium | Documents | Use ICU's `islamic-umalqura` only; never hand-roll conversion tables | Matches ICU data, not local moon sighting |
| Phase 1 mass utility migration causes visual regressions | High | Design system | Mechanical migration, checked by a visual QA pass over the component gallery plus Playwright on covered paths | Gallery coverage is partial |

## Final Compliance Report

- Phase 0 touches no API contract, no DB schema, no production dependency and no
  design-system governance file.
- `BACKWARD_COMPATIBILITY.md`: additive only — one new module path
  (`@open-mercato/shared/lib/i18n/direction`), one new context field, one new
  hook, one new optional provider prop. `I18nContextValue.direction` is required
  on the type, but the type has no third-party implementers (it is constructed
  only by `I18nProvider`).
- Validation for Phase 0: shared unit tests, app + template layout tests,
  `yarn typecheck`, `yarn lint`, `yarn template:sync`, repo-wide guards.

## Changelog

- **2026-09-25** — Phase 0 implemented: `direction.ts` authority,
  `useDirection()`, `<html dir>` in the app shell plus `DocumentDirection` for
  client-side locale changes, with unit, context and layout tests. Phases 1–4
  scoped for follow-up.
- **2026-09-25 (Phase 1)** — logical-utility migration applied repo-wide (574
  files, ~2 000 tokens), `rtl-safe-utilities.test.ts` added to the repo-wide
  guard enumeration, `.ai/ds-rules.md` gained the Direction section, and the
  centred-overlay idiom was made direction-correct (19 sites). Twelve further
  direction-dependent patterns that have no logical equivalent are enumerated as
  Phase 1b.
