# Arabic-First RTL and Saudi Localization

**Status:** Phase 0 and Phase 1 implemented (2026-09-25); Phase 1b–4 planned
**Scope:** OSS (`packages/shared`, `packages/ui`, `apps/mercato`) + planned app-local modules
**Related:** [`.ai/specs/2026-09-03-extensible-locale-set.md`](2026-09-03-extensible-locale-set.md), [`.ai/specs/2026-05-18-date-locale-settings.md`](2026-05-18-date-locale-settings.md), [`.ai/specs/2026-09-25-saudi-localization-module.md`](2026-09-25-saudi-localization-module.md)

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

**Audited 2026-09-25** by compiling each candidate utility with the installed Tailwind
4.3.3 and reading the emitted CSS, instead of assuming:

- **`space-x-*` was on this list by mistake and is off it.** Tailwind 4 compiles it to
  `margin-inline-start`/`margin-inline-end`, so it already mirrors; its 12 sites need no
  change and the guard no longer calls it unsafe.
- **`bg-gradient-to-r/l` is real**: the emitted rule is
  `--tw-gradient-position: to right in oklab`, fixed to a physical side. There is no
  logical gradient, so each site is a decision — the DataTable sticky-column shadows are
  the canonical case and need `rtl:bg-gradient-to-l/r`.
- **`origin-left/right` is real**: Tailwind has no logical origin. One site (the messages
  thread panel) needed `rtl:origin-right`.
- **Inline `style={{ left }}` / `{{ right }}` is real and now enforced**: no class can fix
  it, so the RTL guard requires either the logical property (`insetInlineStart`,
  `insetInlineEnd`, `marginInlineStart`, `paddingInlineStart`) or an `rtl-physical` marker
  on the line — or on the line above it, since a style object has no room for a trailing
  comment — with a reason.

That audit is **finished for the tree**: 15 offsets were converted (the sidebar collapse
toggle and the `DataTable` tree-row indent, both visible on every screen; the JSON
viewer's four; the sidebar customization tree; four category/organisation tree indents;
the command palette anchor; the organisation switcher in both the app and the template)
and the 27 offsets that are physical on purpose — operator-chosen docks and screen
corners, popovers positioned from measured rectangles, canvas and diagram handles, Gantt
and trace spans on a time axis, map pins on a bitmap, email margins for clients without
logical properties — carry a marker and a reason, so a new one cannot slip in unnoticed.

Closed since (2026-09-26):

1. **`translate-x-*` audited to the end.** Only two sites moved a purely physical
   distance — the `Switch` and `ThemeToggle` knobs, which now carry `rtl:-translate-x-*`
   so the indicator travels toward the labelled side in Arabic. The rest were
   `translate-x-0` resets, the centring idiom, or an operator-chosen dock already marked.
   `bg-left/right` no longer exists anywhere in the tree.
2. **The guard can see what it was blind to.** It now scans whole-file string literals
   instead of one line at a time — a class list that wraps onto the next line, the shape
   every `cn(...)` call takes, was previously never scanned — and blanks comments before
   scanning, so an apostrophe in a comment can no longer desync quote matching and
   attribute a token to a line that merely mentions it. Switching it on surfaced 20 real
   physical utilities (`text-left` ×15, `ml-auto`, `mr-0.5`, `-right-0.5`,
   `border-l-[3px]`, `rounded-l/r-[calc(…)]` ×2); all are logical now.
3. **`ScrollArea` is direction-aware by default.** The primitive derives `dir` from the
   i18n context (`useDirection()`, which falls back to `ltr` outside a provider) instead of
   leaving Radix on its LTR default, while still accepting an explicit `dir` override.
4. **Sticky-column shadows mirror.** The `DataTable` before/after gradients sit on logical
   insets, so they now carry `md:rtl:before:bg-gradient-to-r` /
   `md:rtl:after:bg-gradient-to-l`.

2. **Direction-as-data primitives are handled.** Navigation chevrons mirror in RTL
   (`pagination`'s first/previous/next/last, the calendar's month and year nav, the
   breadcrumb arrow divider, the step-indicator connector), the recharts `bar` and `line`
   implementations reverse the category axis and move the value axis to the right, and the
   rich editor's content is `dir="auto"` so each paragraph follows its own first strong
   character.

Still open in this phase:

1. The kanban horizontal scroller (`customers` deals pipeline): `stepScroll`,
   `updateScrollEdges` and `laneOffsets` all assume LTR `scrollLeft` coordinates, so its
   two edge-stepping buttons stay physical behind an `rtl-physical` marker carrying that
   reason. Converting the scroller is a behavioural change and needs a Playwright run
   under `ar` before it ships.
2. `ScheduleGrid` and the customers time grid keep a left-to-right time axis on purpose —
   a chronological axis that runs right-to-left is genuinely ambiguous for an operator
   reading a day — but that decision is not yet stated in the primitives, and the drag
   handles in the customers calendar views have not been audited.

### Phase 2 — Arabic content completeness

**Progress 2026-09-26 (module dictionaries):** `dashboards` (117 keys),
`notifications` (96), `currencies` (158), `dictionaries` (128), `progress` (18),
`api_keys` (40), `phone_calls` (40), `audit_logs` (64), `directory` (103),
`onboarding` (103), `feature_toggles` (94), `integrations` (129) and `sync_excel` (105)
ship complete `i18n/ar.json` files — real translations, with the only
Arabic-to-English matches being literal examples that must stay that way (`USD` as a
code example, `$` as a symbol example, `slug_name` as a key example, the
`⌘/Ctrl + Enter` shortcut, the `—` empty-value dash), plus the `JSON` type name, a logo
URL placeholder, and one statutory string — `onboarding.form.legalEntity`, the Polish
entity's register entry, which a translation would misstate. The customer portal
(`portal`, 141 keys) followed on 2026-09-27 — a customer-facing surface for the Saudi
market, and its only English-identical values are the password mask and the two
`you@example.com` email placeholders, which are examples rather than copy.
Policy that the gate now enforces: a module's `ar.json` must be *whole* — every key
present, values actually Arabic — because a partially translated file renders a
half-English screen that looks finished. `scripts/i18n-check-sync.ts` therefore
treats any locale-shaped dictionary a folder ships as a checked locale (the
platform's `pl/es/de/ko` parity set is still required everywhere;
`.hardcoded-allowlist.json` is excluded by pattern). Rollout order, smallest
high-visibility surfaces first: `dashboards` ✅, `notifications` ✅, `currencies` ✅,
`dictionaries` ✅, `progress` ✅, `api_keys` ✅, `phone_calls` ✅, `audit_logs` ✅,
`directory` ✅, `onboarding` ✅, `feature_toggles` ✅, `integrations` ✅,
`sync_excel` ✅, `portal` ✅ (141), then the large ones in their own slices: `auth` ✅ (718,
455 of which are the ACL matrix), `catalog` ✅ (724), `wms` ✅ (1 057), `sales` (1 494),
`customers` (2 880), `staff` (2 066). Still without an `ar.json` and therefore
English-only for Arabic users, in rough value order: `workflows` (2 262),
`agent_orchestrator` (1 493), `warranty_claims` (1 268), `resources` (768), `eudr` (749),
`planner` (563), `security` (485), `business_rules` (399), `customer_accounts` (363),
`messages` (262), `entities` (258), `configs` (201), `inbox_ops` (195), `attachments` (183),
`communication_channels` (177), `sso` (146), `data_sync` (134), `payment_gateways` (85),
`shipping_carriers` (83), `push_notifications` (77), `record_locks` (76), `query_index` (67)
and `translations` (46) — the counts come from an audit of every module dictionary that
ships `en.json` without `ar.json`.

1. Ship `ar` dictionaries for every module that ships `en` (module-level
   `i18n/ar.json`), and make `i18n:check-sync` aware of the app-extended locale
   set instead of the platform's shipped five. Note the constraint found while
   implementing Phase 0: `registerLocales` validates the base subtag against the
   ISO 639-1 table, so a 639-2/3 code such as `ckb` (Central Kurdish) or `nqo`
   cannot be served today — widen the validation or document the limit.
2. **Implemented 2026-09-26 — Arabic layout and typography.** The app (and the create-app
   template) define `--font-arabic` as a platform stack — `"SF Arabic", "Geeza Pro",
   "Segoe UI", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma` — and an
   `html[dir='rtl']` block swaps `--font-sans` for it and loosens the leading to 1.7,
   because Arabic ascenders, descenders and diacritics sit higher and lower than Latin's.
   **Numerals policy: Western digits (0-9) everywhere.** Numbers reach the DOM through
   `Intl` with the `latn` numbering system, so the CSS block changes metrics only.
3. **Implemented 2026-09-26 — locale labels for app-registered locales.**
   `SHIPPED_LOCALE_LABELS` gained `ar: { key: 'common.languages.arabic', native: 'العربية' }`
   and the app dictionaries (en + ar) and their template mirrors carry
   `common.languages.arabic`, so the switcher renders the language's own name instead of
   depending on `Intl.DisplayNames`.
4. Locale-aware `Intl` formatting for numbers, currency and dates everywhere a value is
   formatted. **Started 2026-09-26.** The decimal-input parser is already locale-aware
   (`parseLocaleNumber` / `resolveLocaleNumberSeparators` in
   `packages/shared/src/lib/number.ts`, covered by
   `ProductUomSection.localeDecimalSeparator.test.ts`), and the customer-facing money and
   date surfaces now pass the active locale instead of `undefined`: the `checkout`
   transaction list and detail, `eudr` plot areas and `documents` comment timestamps.
   The rule for the remainder: a **runtime** surface passes `useLocale()` (or the server
   equivalent) into `formatCurrency` / `formatDate` / `Intl.*`; a gallery, fixture or docs
   sample may pin a locale deliberately, and says why in a comment. Still on `undefined`:
   `sales` (`SalesDocumentsTable`, `messageObjectPreviews`), the `design_system` gallery
   fixtures (pinned on purpose) and the AI-assistant `ui-parts.mdx` sample.
5. **Implemented 2026-09-25 — the app serves English and Arabic only.** The
   platform still ships five dictionaries, but this app carries `en` and `ar`
   and nothing else, so:
   - `restrictServedLocales()` (shared) narrows what the app *offers*, because a
     locale whose dictionaries are missing would render raw keys in every module
     that never had one;
   - the app's dictionary loader carries exactly the two cases;
   - `i18n:check-sync` treats `apps/mercato/src/i18n` as the authority for the
     app-level set, so a deleted dictionary is not recreated on the next commit,
     while module dictionaries keep the platform's full parity set.

   Adding a language later is three edits: drop `src/i18n/<code>.json`, add its
   case to the loader, and name it in `registerLocales` + `restrictServedLocales`.

### Phase 3 — Saudi localization module

A new app-local module `saudi_localization` owns the Kingdom-specific surface.
Its own spec is
[`.ai/specs/2026-09-25-saudi-localization-module.md`](2026-09-25-saudi-localization-module.md).

1. **VAT 15%** default tax rate plus registration metadata (VAT number, CR
   number), with rate history so historical invoices keep their rate.
   *Primitives implemented* (rate constant, `isValidSaudiVatNumber`, halala
   rounding, net/VAT/gross breakdown); the settings entity and API are next.
2. **ZATCA Phase 1 QR** — the 5-tag TLV (Base64) payload that must appear on
   simplified tax invoices: seller name, VAT registration number, ISO-8601
   timestamp, invoice total including VAT, VAT total. *Implemented* as a pure,
   vector-tested function.
3. **ZATCA Phase 2 integration** — UBL 2.1 invoice XML, invoice hash, previous
   invoice hash (PIH), invoice counter value (ICV), cryptographic stamp
   (compliance/production CSID), and the clearance (standard invoices) /
   reporting (simplified invoices) pipeline with retry and an audit-trail
   entity.
   *Deterministic half implemented* (`saudi_localization/lib/zatca/`): a
   canonical-by-construction XML writer, the hash convention proved against the
   published first-invoice constant, ICV/PIH sequencing behind a store port, and
   UBL 2.1 assembly carrying the sourced business rules. Still missing: the XAdES
   signature and the `UBLExtensions` wrapper it lives in, CSID onboarding, the
   persistent chain store bound into the invoice pipeline, and sandbox
   validation.
4. **Hijri (Umm al-Qura) dates** — *Helpers implemented* in
   `saudi_localization/lib/saudi/hijri.ts` (`Intl` with `islamic-umalqura`,
   `Asia/Riyadh` default, dual-calendar label); wiring them into invoice, HR and
   fiscal document templates is next.
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

Phase 3 (design intent): `POST /api/saudi_localization/zatca/submit`,
`GET /api/saudi_localization/zatca/submissions`, `GET /api/saudi_localization/vat-settings`, guarded by
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
- **2026-09-25 (Phase 3, first slice)** — `saudi_localization` created with the
  ZATCA Phase 1 QR payload builder and the Saudi VAT primitives (rate,
  VAT-number validation, halala rounding, net/VAT/gross breakdown), 31 unit tests
  including a hand-built TLV vector and an independent decoder. Module spec:
  [`.ai/specs/2026-09-25-saudi-localization-module.md`](2026-09-25-saudi-localization-module.md).
- **2026-09-25 (app locale set)** — the app now serves English and Arabic only.
  `restrictServedLocales()` / `clearServedLocaleRestriction()` added to shared
  (with the default locale always kept and unknown codes ignored), the app
  dictionary loader trimmed to `en`/`ar`, and `i18n:check-sync` taught to keep
  module-level parity without recreating app-level dictionaries.
- **2026-09-25 (Phase 3, second slice)** — the Saudi VAT settings API and its
  backend screen, with real optimistic locking on the settings record.
- **2026-09-25 (Phase 3, ZATCA Phase 2 groundwork)** — the deterministic core of
  ZATCA Phase 2 in `saudi_localization/lib/zatca/`: canonical XML writer, the hash
  convention proven against the published first-invoice constant, ICV/PIH sequencing
  (in-memory port, then a `module_configs`-backed store), a sales order → invoice
  mapping with explicit VAT-category rules, and UBL 2.1 assembly carrying the
  sourced business rules. The QR panel renders the payload on the order detail.
  Signed XAdES, CSID onboarding and sandbox validation remain open.
- **2026-09-25 (Phase 1b) — the physical offsets audited and closed for the tree.** The
  audit was done by compiling each candidate utility with the installed Tailwind 4.3.3 and
  reading the emitted CSS, which corrected one claim and confirmed the rest:
  `space-x-*` is *logical* in v4 (no work needed; it was listed as unsafe by mistake),
  while `bg-gradient-to-*`, `origin-*` and inline `left`/`right` offsets are genuinely
  physical. 15 offsets were converted to logical properties — the sidebar collapse toggle
  and the `DataTable` tree indent, which every screen renders — 27 were left physical with
  an `rtl-physical` marker and a reason, and the RTL guard gained an enforceable rule for
  inline offsets, which no class can fix.
- **2026-09-25 (Phase 2, Arabic rollout starts)** — `dashboards`, `notifications`,
  `currencies`, `dictionaries`, `progress`, `api_keys`, `phone_calls` and `audit_logs`
  ship complete Arabic dictionaries (661 keys between them), and `i18n-check-sync` now
  holds any shipped locale to full parity instead of only the platform's `pl/es/de/ko`
  set. Rollout order recorded in the Phase 2 section.
- **2026-09-26 (Phase 2, Arabic rollout continues)** — the remaining small admin modules
  ship complete Arabic dictionaries: `directory` (103 keys), `onboarding` (103),
  `feature_toggles` (94), `integrations` (129) and `sync_excel` (105) — 534 keys, which
  takes the shipped module total to 1 195. Only four values stay identical to English:
  the `JSON` type name, a logo URL placeholder, the `—` empty-value dash, and the Polish
  legal entity's statutory register entry, which is deliberately kept in its registered
  language.
- **2026-09-26 (Phase 2, the large modules: auth)** — `auth` ships 718 Arabic keys,
  including the whole access-control matrix (370 `acl.features.*` permission descriptions
  and 58 `acl.modules.*` group headers — the surface every role editor renders). Three
  values stay Latin on purpose: the product name on the login screen, the `SSO` acronym,
  and the `...` loading placeholder. This slice also adds the rollout verifier in
  `apps/mercato/.mercato/ar-audit/`, which enforces key set **and** order against
  `en.json`, placeholder and `\n` parity, indentation, no blank lines, Arabic coverage,
  and agreement with any key the app dictionary already translates. `yarn i18n:check-sync`
  and the module's own `acl-feature-catalog.i18n` test are green.
- **2026-09-26 (Phase 2, the large modules: catalog)** — `catalog` ships 724 Arabic keys:
  the product list plus the create/edit forms (433 keys), variants, price kinds,
  categories, units of measure, the SEO helper and the merchandising assistant. This
  slice fixes the vocabulary the remaining ones reuse: المتغيّر (variant),
  الفئة الضريبية (tax class), معدّل الضريبة (tax rate), قناة البيع (sales channel),
  المعرّف النصي (handle) as against معرّف الرابط (slug), شرائح (tier pricing). Two values
  stay Latin on purpose — an example storefront handle and the `1 kg = 1000 g`
  unit-conversion equation — and `catalog.products.edit.offers.deleteError` deliberately
  keeps the value the app dictionary already ships, so one key cannot read two ways.
- **2026-09-26 (Phase 1b, closed for the tree)** — the RTL audit finished the two open
  items and hardened the guard that keeps them closed. `translate-x-*` was audited to the
  end (two knobs mirrored with `rtl:-translate-x-*`; the rest are resets, the centring
  idiom, or marked docks) and `bg-left/right` no longer exists. The guard now scans
  whole-file literals rather than one line at a time and blanks comments first, which
  surfaced 20 real physical utilities that the per-line scan had never seen (15 `text-left`,
  `ml-auto`, `mr-0.5`, `-right-0.5`, `border-l-[3px]`, two `rounded-l/r-[calc(…)]`).
  `ScrollArea` now derives `dir` from the i18n context, so Radix stops defaulting to LTR in
  Arabic, and the `DataTable` sticky-column gradients mirror with their logical insets.
  What remains is one behavioural item — the kanban scroller's LTR-shaped `scrollLeft`
  math, marked `rtl-physical` with that reason — plus the direction-as-data primitives.
- **2026-09-26 (Phase 1b + Phase 2, direction-as-data and Arabic typography)** — the
  primitives that read direction as data now behave in Arabic: navigation chevrons mirror
  (`pagination`'s four controls, the calendar's month and year navigation, the breadcrumb
  arrow divider, the step-indicator connector), the recharts `bar` and `line` charts
  reverse the category axis and move the value axis to the right, and the rich editor's
  content is `dir="auto"` so every paragraph follows its own first strong character.
  Typography: `--font-arabic` (platform stack, no webfont payload) is swapped in under
  `html[dir='rtl']` together with a 1.7 leading for Arabic ascenders and diacritics, with
  Western digits kept as policy. Locale labels: `ar` joined `SHIPPED_LOCALE_LABELS` and the
  app dictionaries plus template mirrors carry `common.languages.arabic`. Verified with
  914 UI primitive/chart tests, the shared i18n suites, both typechecks, `yarn i18n:check`
  and `yarn template:sync`.
- **2026-09-26 (Phase 2, locale-aware formatting starts)** — the money and date surfaces a
  customer actually reads now format in the application locale instead of the machine's:
  the `checkout` transaction list and detail (`formatAmount` / `formatDate` /
  `formatDateTime`), `eudr` plot areas, and `documents` comment timestamps all thread
  `useLocale()` into their helpers. The decimal-input parser was already locale-aware
  (`parseLocaleNumber`), so the remaining work is the `sales` surfaces and the deliberate,
  documented pins in the gallery and docs fixtures.
- **2026-10-09 (Phase 2, the WMS module)** — `wms` ships 1 057 Arabic keys: the warehouse,
  location, zone and inventory-profile configuration screens, the inventory console
  (receive, adjust, move, reserve, release, cycle count), the balances, reservations and
  movement-ledger lists, the operational dashboard, the location/lot/SKU detail views, the
  low-stock and reservation-shortfall notification renderers, and the catalog/sales widget
  injections. One value needed a decision the brief could not make for it: the two
  `…activity.titles.generic` keys are placeholder-only templates (`{type} {quantity}× {sku}`)
  whose `{type}` the caller fills with an already-translated label, so they carry no words to
  translate — they read `حركة {type} · {quantity}× {sku}` to stay non-empty in Arabic while
  leaving every placeholder byte-identical. Values that stay Latin are only the acronyms and
  symbols the brief exempts (`SKU`, `RMA`, `WMS`, `FEFO`/`FIFO`/`LIFO`, `…`, `—`), and the
  key order matches `en.json` exactly (`ar-audit/verify.mjs` → `keys=1057 OK`);
  `yarn i18n:check-sync` stays green and all 49 `wms` test suites (300 tests) pass.
