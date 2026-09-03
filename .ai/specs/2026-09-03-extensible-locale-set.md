# Extensible Locale Set

## TLDR

The set of languages Open Mercato can serve was a closed TypeScript union
(`type Locale = 'en' | 'pl' | 'es' | 'de' | 'ko'`), so a downstream application could not add
a language without patching `node_modules` or waiting for a platform release. This spec makes
the set extensible at three levels — compile time (a registry interface apps augment), runtime
(a `globalThis` locale registry), and operations (the existing tenant-scoped
`translations.supported_locales` setting now drives the UI locale set, not just the content
translation editor) — while leaving an application that adds nothing byte-for-byte unchanged.

**No new language is added by this change.** The shipped set remains `en, pl, es, de, ko`.

## Overview

Three independent mechanisms, each useful on its own:

| Level | Who uses it | Mechanism |
|-------|-------------|-----------|
| Type | Application developer | `declare module` augmentation of `LocaleRegistry` |
| Runtime | Application developer | `registerLocales([...])` at bootstrap |
| Operations | Tenant administrator | Settings → Module Configs → Translations |

Plus two supporting changes that make an added locale actually usable: a shared locale-label
resolver that degrades gracefully for any code, and a default-locale fallback layer in
`loadDictionary` so an untranslated locale renders English rather than raw keys.

## Problem Statement

`packages/shared/src/lib/i18n/config.ts` was four lines, and its first line was the blocker:

```ts
export type Locale = 'en' | 'pl' | 'es' | 'de' | 'ko'
```

A union type is a compile-time construct. No environment variable, config value, DI
registration or runtime hook can widen one. Three consequences followed:

1. **Adding a language required a platform release.** Korean was added in commit `2d44e63e6`,
   an edit to this file — precisely the coupling this spec removes.
2. **Local widening did not compile.** Three exhaustive `Record<Locale, string>` label maps
   (`packages/ui/src/backend/ProfileDropdown.tsx`, `packages/ui/src/frontend/LanguageSwitcher.tsx`,
   `packages/checkout/src/modules/checkout/components/PayPage.tsx`) became errors the moment an
   app widened the union, and `packages/shared/package.json` resolves `types` to source, so an
   app's `tsc` type-checks those files.
3. **Downstream apps patched `node_modules`** in two packages, and every platform release
   touching either file rejected the patches.

The platform was also inconsistent with itself. `packages/core/src/modules/translations/` already
treats supported locales as **runtime, tenant-scoped, `string[]` configuration**, with a finished
admin screen (`LocaleManager`) that offers all 183 ISO 639-1 codes, an ACL feature
(`translations.manage_locales`), a mutation guard, and a `PUT /api/translations/locales`
endpoint. Nothing in `detectLocale()`, `/api/auth/locale`, `LanguageSwitcher` or
`ProfileDropdown` read it. A tenant could add French and translate product titles into French,
but no one could switch the admin UI to French.

## Proposed Solution

### 1. Type layer — `LocaleRegistry`

```ts
export interface LocaleRegistry { en: true; pl: true; es: true; de: true; ko: true }
export type Locale = keyof LocaleRegistry & string
```

An application widens it from its own source tree:

```ts
declare module '@open-mercato/shared/lib/i18n/config' {
  interface LocaleRegistry { cs: true }
}
```

Unaugmented, `Locale` resolves to exactly the previous five-member union — same assignability,
same exhaustiveness. This is the idiom TypeScript uses on itself: `lib.es5.d.ts` declares
`NumberFormatOptionsStyleRegistry` with `type NumberFormatOptionsStyle = keyof …Registry`, and
`lib.es2020.intl.d.ts` additively merges `unit` into it.

Critically, an app that opts in **keeps exhaustiveness over its own extended set** — a
`Record<Locale, T>` in that app must now cover six locales. Widening `Locale` to `string` would
have silently destroyed that guarantee for the platform and every app relying on it.

### 2. Runtime layer — `locale-registry.ts`

A `globalThis`-keyed registry, matching the idiom already used by
`lib/modules/registry.ts`, `lib/i18n/dictionary-cache.ts` and `lib/di/container.ts` (all of which
document the same reason: tsx/esbuild can load one file as several module instances).

- `registerLocales(codes)` — normalizes (`pt_BR` → `pt-br`), validates against ISO 639-1,
  invalidates the dictionary cache, idempotent, and **warns rather than throws** on an unknown
  code so one bad entry cannot take an app down at boot.
- `getSupportedLocales()` — the platform baseline plus registered extras. Returns the `locales`
  array itself when nothing is registered, so the zero-config path allocates nothing.

`locales` and `defaultLocale` keep their names, types and values. Consumers that validate user
input moved from the static array to `getSupportedLocales()`: `resolveSupportedLocale`,
`detectLocale` (both the cookie and `Accept-Language` branches), and `/api/auth/locale`.

The type layer is **advisory**; this is the authority. Declaration merging applies when a package
is *installed*, not when it is *enabled*, so the types can claim a locale the running app never
registered. Every entry point therefore validates at runtime regardless.

### 3. Client layer — through the existing provider

Server-side registration cannot reach client components: `lib/i18n/server.ts` pulls `server-only`,
and `LanguageSwitcher` is a `"use client"` component. The seam already existed — the root layout
computes locale configuration server-side and passes it into the client `I18nProvider`, exactly
as `localeLocked` does.

- `I18nContextValue` gains `supportedLocales`.
- `I18nProvider` gains an **optional** `supportedLocales` prop, defaulting to
  `getSupportedLocales()`, so the ~15 existing tests that mount `<I18nProvider locale dict />`
  are untouched.
- `useSupportedLocales()` is the hook the three label sites now iterate.

### 4. Label layer — `resolveLocaleLabel(locale, t?)`

Replaces all three exhaustive maps with one resolver:

1. shipped table → `t ? t('common.languages.german', 'Deutsch') : 'Deutsch'`
2. `Intl.DisplayNames([locale], { type: 'language' })` → the endonym for any code, no dependency
3. `getIso639Label(locale)` → the English name
4. `locale.toUpperCase()` → never blank

The shipped five keep hand-written labels because `Intl` disagrees on casing (`español`,
`polski` vs. the rendered `Español`, `Polski`). `ProfileDropdown` passes no translator (it
renders endonyms); `LanguageSwitcher` and `PayPage` pass one (they render localized names). Output
is byte-identical for all five locales in all three components.

### 5. Operations layer — the existing settings screen becomes authoritative

`packages/core/src/modules/translations/di.ts` registers a resolver that reads
`moduleConfigService.getValue('translations', 'supported_locales', { scope: { tenantId } })`.
`@open-mercato/shared` cannot read tenant configuration itself, so the dependency is inverted the
same way `registerTranslationOverlayPlugin` already inverts it for content translations.

The served set is the tenant's selection **intersected** with what the app can actually serve.
Intersecting rather than replacing means a code configured but with no dictionary source behind
it can never reach a language switcher, so a typo in the settings screen cannot strand a tenant
in a broken UI. An empty intersection falls back to the full set for the same reason, and the
resolver never throws — it runs in the root layout, where a failure would take down every page.

### 6. Dictionary fallback

Only ~76% of `t()` call sites (9,002 of 11,908 measured) pass an inline English fallback, so a
locale with no dictionary would render ~24% of its strings as raw keys such as
`translations.locales.title`. `loadDictionary(locale)` now layers the default-locale dictionary
underneath **locales outside the shipped baseline only**, then overlays the requested locale.
The shipped five keep byte-identical merge and cache semantics; an added locale degrades to
English, which is what every comparable platform does.

## Architecture

```
                    ┌─ compile time ─────────────────────────────┐
  app source ──────►│ declare module … { interface LocaleRegistry }│──► Locale widens
                    └────────────────────────────────────────────┘

                    ┌─ runtime (authority) ──────────────────────┐
  app bootstrap ───►│ registerLocales([...])  →  globalThis       │
                    │            getSupportedLocales()            │
                    └───────────────┬────────────────────────────┘
                                    │
  tenant settings ──► translations/di.ts registers resolver       │
                                    │                             │
                      resolveSupportedLocalesForRequest()  ◄──────┘
                        = tenant selection ∩ servable
                                    │
              root layout ──────────┴──────────────┐
                    │                              │
       detectLocale({ supportedLocales })   I18nProvider supportedLocales
                    │                              │
              loadDictionary                useSupportedLocales()
             (default-locale base                  │
              layer for added locales)   LanguageSwitcher / ProfileDropdown / PayPage
                                                   │
                                          resolveLocaleLabel(locale, t?)
```

## Data Models

No schema change. The operations layer reuses the existing `module_configs` row
`(module_id='translations', name='supported_locales', tenant_id=<tenant>)`, written by the
already-shipped `PUT /api/translations/locales`. No migration.

## API Contracts

| Route | Change |
|-------|--------|
| `POST /api/auth/locale` | Validates against the runtime supported set instead of a module-scope `Set` snapshot. Same 400 on an unsupported code. |
| `GET /api/auth/locale` | Same. |
| `GET`/`PUT /api/translations/locales` | Unchanged. |

The zod schema on `/api/auth/locale` changed from `z.enum(locales)` to
`z.string().refine(isSupportedLocale)`. Both the `Set` and the enum were built at **module
scope**, so a locale registered after first import would have been rejected for the process
lifetime. The published OpenAPI document consequently describes `locale` as a string rather than
enumerating five values — accurate, since the valid set is now per-deployment and per-tenant.

## UI/UX

No visual change out of the box. The language switcher and profile dropdown render the same five
languages with the same labels. When a locale is added, it appears in both, labelled with its
endonym (e.g. `čeština`), and untranslated chrome falls back to English.

## Configuration

| Surface | Who | Effect |
|---------|-----|--------|
| `declare module` augmentation | developer | widens `Locale` for the app's own typecheck |
| `registerLocales([...])` | developer | adds to the served set at runtime |
| Settings → Module Configs → Translations | tenant admin | narrows the served set for that tenant |
| `OM_FORCE_LOCALE` | ops | unchanged — still pins the app to one locale |

## Alternatives Considered

**Widen `Locale` to `string`.** One line, no new idiom. Rejected: it deletes every compile-time
guarantee the platform and its applications have. An app relying on an exhaustive
`Record<Locale, …>` as a drift guard would silently lose it with no error anywhere. The prior-art
survey found this is what most platforms do (Medusa, Shopify, Odoo, WordPress all use a plain
string), but they never had the union in the first place, so nothing regresses for them.

**Branded string (`string & { __locale?: never }`).** Accepts any code without augmentation, but
gives neither exhaustiveness nor autocomplete — most of the downside of `string` plus confusion.

**Generate the union from the filesystem** (as Saleor generates its enum from a CLDR dump at
boot). Rejected: the generator already discovers locales from `**/i18n/*.json`, but a generated
union in `config.ts` would still be a platform-owned file, and the app's own dictionaries live
outside the packages, so it does not solve the ownership problem.

**Make `detectLocale()` read tenant config itself.** Rejected: it is called from
`resolveTranslations()` on essentially every API route, and adding a container construction plus
a database read to that path is a real performance change. The optional options bag lets the one
caller that has request context (the root layout) pay the cost once per render.

## Implementation Approach

1. `config.ts` — `LocaleRegistry` + derived `Locale`; both `export const` lines untouched.
2. New `locale-registry.ts` — `globalThis` registry, resolver slot, request resolution.
3. New `locale-label.ts` — the four-rung label resolver.
4. `locale.ts`, `server.ts`, `context.tsx` — read the registry; optional `detectLocale` options;
   optional provider prop; `useSupportedLocales()`; default-locale fallback in `loadDictionary`.
5. Three label sites — drop `Record<Locale, string>`, use the hook and the resolver.
6. `/api/auth/locale` — lazy validation.
7. `translations/di.ts` + `lib/supported-locales.ts` — register the tenant resolver.
8. Root layout + `AppProviders` in the app and the create-app template.
9. Tests and the `config.typecheck.tsx` compile-time guard.

## Migration & Backward Compatibility

**Nothing is required of existing applications.** An app that adds nothing keeps the same five
locales, the same default, the same detection order, the same dictionary merge and cache
semantics, and the same rendered labels.

Per `BACKWARD_COMPATIBILITY.md`, every touched surface stays within its classification:

| Surface | Category | Change |
|---------|----------|--------|
| `Locale` | 2 — Type Definitions (STABLE) | Additive. Resolves to the identical union unless an app opts in; it can only ever **widen**, never narrow. |
| `locales`, `defaultLocale` | 2 (STABLE) | Unchanged — same name, type, value, order, and literal source text. |
| `detectLocale()` | 3 — Function Signatures (STABLE) | New **optional** parameter. |
| `I18nProvider` | 2 (STABLE) | New **optional** prop. |
| `resolveSupportedLocale`, `loadDictionary`, `useT`, `resolveTranslations` | 3 (STABLE) | Signatures unchanged. |
| `@open-mercato/shared/lib/i18n/*` | 4 — Import Paths (STABLE) | Additive only; two new modules, nothing moved or renamed. |
| `/api/auth/locale` | 7 — API Route URLs (STABLE) | Same URL, same status codes. |

Nothing is deprecated, so the deprecation protocol does not apply.

The one behaviour difference an application can observe: a locale **outside** the shipped
baseline now receives the default-locale dictionary as a base layer. This cannot affect
`en`/`pl`/`es`/`de`/`ko`, and no such locale can exist without the app opting in.

## Risks & Impact Review

| # | Scenario | Severity | Area | Mitigation | Residual |
|---|----------|----------|------|------------|----------|
| 1 | `Locale` accidentally degrades to `string` in a later refactor, silently deleting exhaustiveness everywhere | High | `packages/shared` | `config.typecheck.tsx` asserts `Locale` is mutually assignable with the five-member union and **not** with `string`; `locale-augmentation.test.ts` compiles fixtures with the real compiler | Low |
| 2 | Types claim a locale the running app never registered (declaration merging applies to *installed*, not *enabled*, packages — a documented Fastify pitfall) | Medium | app typecheck | The runtime registry is the sole authority; every validation point calls `getSupportedLocales()`/`isSupportedLocale()` rather than trusting the type | Low |
| 3 | A tenant configures a locale with no dictionary and strands its users | Medium | `translations` | The served set is intersected with what is servable; an empty intersection falls back to the full set | Low |
| 4 | The tenant-config read fails or is slow in the root layout, breaking every page | High | root layout | The resolver is wrapped in try/catch at two levels and falls back to the full set; `ModuleConfigService` caches 60s with tag invalidation; the read is skipped entirely for anonymous requests | Low |
| 5 | A module-scope snapshot of the locale set rejects a later-registered locale for the process lifetime | Medium | `/api/auth/locale` | Both the `Set` and the zod enum were replaced with per-request evaluation | Low |
| 6 | Rendered language labels change for existing locales | Medium | `packages/ui`, `packages/checkout` | The shipped five keep hand-written labels (measured: `Intl` returns lowercase `español`/`polski`); `locale-label.test.ts` pins all five in both the translator and no-translator modes | Low |
| 7 | The default-locale base layer leaks English strings into `pl`/`es`/`de`/`ko` | High | `packages/shared` | The layer applies only to locales outside the shipped baseline; `dictionary-locale-fallback.test.ts` asserts an English-only key does **not** appear in Polish | Low |

**Known pre-existing issue, not introduced here:** `scripts/dev.mjs` regex-parses `config.ts` as
text to build the dev splash screen, and its `parseStringArrayLiteral` finds the `[` of the
`Locale[]` type annotation before the array literal, so it already returns `[]` and falls back to
a stale four-locale list. Verified identical before and after this change. Worth a follow-up.

## Success Metrics

- An application can serve a locale the platform does not ship without patching any
  `@open-mercato/*` package — verified by compiling a downstream-app fixture.
- A tenant administrator can change the served set from Settings with no deploy.
- Zero-config behaviour is unchanged: the existing i18n test suites pass untouched.

## Final Compliance Report

| Requirement | Status |
|-------------|--------|
| No patching or forking to add a locale | Met — proven by `locale-augmentation.test.ts` |
| Works at runtime **and** type level | Met |
| Works in client components | Met — via `I18nProvider` prop + `useSupportedLocales()` |
| UI degrades gracefully for an unlabelled locale | Met — four-rung resolver, never blank |
| No regressions with zero config | Met — 7 pre-existing i18n suites pass unmodified |
| Backward compatible per `BACKWARD_COMPATIBILITY.md` | Met — additive only, table above |
| Type safety preserved | Met — exhaustiveness retained on the app's own extended set |
| Tests for the mechanism + regression coverage | Met — 5 new suites |
| No `any`, kebab-case filenames, zod validation, no new dependencies, no hand-written migrations | Met |

**Tests rewritten:** one — `apps/mercato/src/app/__tests__/layout.test.tsx` (and its template
mirror) `jest.mock`s `@open-mercato/shared/lib/i18n/server` with an explicit export list, so the
new `resolveSupportedLocalesForRequest` had to be added to the mock. This is a mock-completeness
change, not a behaviour change; an assertion covering the new prop was added alongside it.

## Open Questions

1. Should an application be able to override `defaultLocale`, not just the served set? Out of
   scope here; `OM_FORCE_LOCALE` covers the pinning case.
2. Should `isValidIso639` accept region subtags (`pt-BR`)? It rejects them today, which is
   stricter than every platform surveyed. `registerLocales` validates the base code so `pt-br`
   can be registered in code, but the settings screen cannot offer it.
3. Should UI chrome translations become DB-editable, so an operator could translate a new
   language without a deploy? Only Odoo and WordPress do this, both file-based. Deliberately out
   of scope.

## Changelog

### 2026-09-03
- Initial specification and implementation.
