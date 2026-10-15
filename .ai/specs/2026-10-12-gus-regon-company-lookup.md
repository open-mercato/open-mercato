# GUS REGON Company Lookup (`@open-mercato/gus-regon`)

- **Date:** 2026-10-12
- **Status:** Implemented — package ported into core (Phase 5); Playwright run against core pending (see Implementation Status).
- **Author:** Cognize (Open Mercato certified partner)
- **Origin:** written and reviewed as SPEC-010 for `open-mercato/official-modules` (PR [official-modules#56](https://github.com/open-mercato/official-modules/pull/56), source commit `9dddb3a`). That repository was deprecated on 2026-10-08 (official-modules#58: new modules go to core), so the package moves here unchanged in behavior.
- **Related:** `financial-pl` SPEC-008 in official-modules (MF *Wykaz* buyer lookup, branch `feat/financial-pl-invoice-ux`); `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`; `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md` (provider-package and env-preset precedent).

## TLDR
**Key Points:**
- Package `@open-mercato/gus-regon`, module id `gus_regon`: looks Polish companies up in the GUS REGON registry (BIR1.1 API) by NIP and fills company name and registered address into CrudForms; the REGON is shown to the operator.
- Value: fast, correct onboarding of Polish suppliers and business customers — including entities outside the VAT register, which MF *Wykaz* does not cover.

**Scope (MVP):**
- Integration provider `gus_regon` with per-organization credentials (environment, secret API key, "Show on CRM company forms" switch) in **Settings → Integrations**, health check, status line on the integration page.
- Fail-open lookup route `GET /api/gus_regon/lookup` and status route `GET /api/gus_regon/status`.
- Optional env preconfiguration (`OM_INTEGRATION_GUS_REGON_*`, applied on tenant creation and by `yarn mercato gus_regon configure-from-env`).
- Built-in, **opt-in** card on the customers company create/edit forms (default off, effective only with an API key).
- Declarative registration (`createGusLookupWidget` + field map) so other modules attach the same card to their own CrudForms.

**Out of scope (deferred):** full BIR1 reports (legal form, PKD, local units), tax id on customer addresses, a shared "company lookup provider" contract with `financial-pl`/VIES.

**Concerns:**
- Overlap with `financial-pl` SPEC-008, which chose the key-less MF *Wykaz* and rejected GUS BIR because of the per-deployment key. This package is complementary (Problem Statement) and mirrors SPEC-008's response contract.
- BIR1 is SOAP with an escaped inner XML document — parsed in two passes with `fast-xml-parser`, covered by fixtures captured from the GUS test endpoint.

---

## Overview
Polish B2B operators identify counterparties by NIP and today type every company field by hand. GUS REGON (BIR1) is the official statistical business register and covers all registered entities. With this package an operator enters a NIP, clicks **Fetch from GUS**, reviews the filled values and saves. Nothing the operator typed is overwritten, and the form keeps working when GUS is unavailable.

Audience: B2B distributors and producers running Open Mercato for Polish counterparties (CRM, purchasing).

> **Market Reference:** wFirma, inFakt, Fakturownia and SaldeoSMART autofill contractors from NIP via MF *Wykaz* and/or GUS (see SPEC-008 market reference). **Adopted:** explicit button, fill-empty-only, fail-open, NIP validated before any upstream call. **Rejected:** automatic lookup on every NIP change (extra upstream calls, surprising overwrites).

## Problem Statement
- **Coverage gap.** MF *Wykaz podatników VAT* lists VAT taxpayers only. VAT-exempt businesses, sole traders not registered for VAT, foundations and associations are missing there but present in REGON.
- **Surface gap.** The `financial-pl` lookup is wired into its invoice editor (`BuyerFields`). Company forms in CRM, supplier forms in purchasing apps and other CrudForms have no lookup.
- **Reuse gap.** A client-app prototype (2026-09-18) proved the BIR1 flow but stored the key in environment variables and added columns to a host entity — not reusable across deployments.

## Proposed Solution
An external-extension package: an integration provider (credentials, health check), two read-only API routes, and injection widgets. No entities and no behavior change in core modules (core only gains the ACL labels, the app/template wiring and the user guide).

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Dedicated workspace package `packages/gus-regon` | Root `AGENTS.md`: every external integration provider lives in its own package, never in `packages/core/src/modules/`; independent of the unreleased `financial-pl`; the lookup is a pure function (`lookupCompanyByNip`) that can later sit behind a shared provider contract |
| Credentials via `integration.ts`; env only as an optional preset | Per-organization, encrypted at rest (tenant DEK), write-only in the credentials API, edited in Settings → Integrations without redeploy — same mechanism as Stripe/Tpay; answers SPEC-008's "per-deployment key" objection. The provider-owned preset (`lib/preset.ts`, `setup.ts` `onTenantCreated`, `cli.ts`) follows `om-integration-builder` and never overwrites an existing configuration unless forced |
| Credentials scope = `resolveActiveOrganizationId(auth)`; unresolved scope → `organizationScopeRequiredResponse()` (400) | Same resolution as the core integration credentials route, so the lookup always uses what the admin sees in Settings → Integrations, including the "all organizations" fallback to the actor's organization |
| Public GUS test key only when `environment = test` and no key is set | Works out of the box for development; production never falls back to it |
| CRM card **opt-in** (`showOnCompanyForms`, default off) and effective only with an API key (also in Test) | Installing the package changes no form by itself; no deployment shows a dead button. The platform credentials form cannot disable one field based on another, so the rule is enforced server-side (`/status`) and explained on the integration page |
| Widgets render only when `/status` says the lookup is usable | No dead cards for organizations that have not enabled the integration |
| Fail-open `{ ok:true, company, candidates } \| { ok:false, reason }` | Same contract as SPEC-008; manual entry is never blocked |
| One 8 s deadline per BIR1 call (headers and body); logout fire-and-forget | Bounded latency (≤ ~16 s); logout never delays the answer or the platform health-check timeout |
| Widget writes into host form values (`onDataChange`), fill-empty-only | Host modules own their fields and persistence; no schema coupling |
| Declarative host registration (`createGusLookupWidget`) | Other modules attach the card with a field map — no React code, standard `widgets/injection` + `injection-table.ts` discovery |
| `fast-xml-parser` | Robust against namespaces, self-closing tags and multi-record answers; values kept as strings (leading zeros) |
| v1 uses `DaneSzukajPodmioty` only | Enough for name, REGON and address; full reports are a follow-up |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Env vars (`GUS_API_KEY`) as the runtime source, as in the prototype | Violates "secrets only via integration credentials"; per deployment instead of per organization. Env stays a one-time preset only |
| Module inside `packages/core/src/modules/` (like `forms`) | `forms` moved into core because it imports core internals; an external provider must be a dedicated package (root `AGENTS.md`) |
| REGON/address columns on host entities | Couples the package to host modules |
| GUS fallback inside `financial-pl` | Ties CRM/purchasing forms to an e-invoicing package and an unmerged branch; still possible later via a shared contract |
| Regex XML parsing (prototype) | Fragile with repeated tags and multi-record answers |
| Card on CRM forms enabled by default | Rejected by product decision: opt-in, and never without a key |

## User Stories / Use Cases
- **A sales admin** wants to **create a company from its NIP** so that **legal name and registered address match the register** → `GET /api/gus_regon/lookup`, built-in company card (UI/UX).
- **A purchasing clerk** (host app) wants to **fill a supplier form from GUS** so that **supplier master data is correct** → `createGusLookupWidget` (UI/UX → Host forms).
- **An administrator** wants to **configure the key once per organization and decide whether CRM forms show the card** → integration credentials + `GET /api/gus_regon/status` + status line (Configuration).

## Architecture

```
CrudForm (company / host form)              Server (gus_regon routes)                 GUS BIR1.1
  └─ injection spot                         GET /api/gus_regon/status                 (test | production)
     └─ GusLookupFormWidget ── apiCall ───▶   ├─ requireAuth + gus_regon.lookup
          (hidden unless status allows)       ├─ integrationStateService.isEnabled
          └─ GusLookupPanel                   └─ integrationCredentialsService.resolve → booleans only
               └── apiCall ──────────────▶  GET /api/gus_regon/lookup?nip=
                   ◀── { ok, company } ───    ├─ NIP structure + checksum (400)
               apply / applyFieldMap          ├─ enabled? credentials (active org)
               → onDataChange(values)         └─ lookupCompanyByNip ─ Zaloguj ────────────▶
                                                                      DaneSzukajPodmioty ─▶
                                                                      Wyloguj (async) ────▶
```

| File | Responsibility |
|------|----------------|
| `lib/nip.ts` | Normalization, MF `TNrNIP` structure, mod-11 checksum (client-safe) |
| `lib/config.ts` | Endpoints, public test key, credentials → runtime config |
| `lib/client.ts` | SOAP 1.2 + WS-Addressing envelope, session id as HTTP header `sid`, one deadline per call |
| `lib/parser.ts` | MTOM envelope extraction, method results, inner `<root><dane>`, error code `4` = not found, primary record selection |
| `lib/lookup.ts` | Orchestration; never throws; logout after successful login (not awaited) |
| `lib/health.ts` + `di.ts` | `gusRegonHealthCheck` (`Zaloguj` succeeds), registered with Awilix `asValue`; translated messages (`gus_regon.health.*`), raw upstream reason only in `details` |
| `lib/status.ts`, `api/status/route.ts`, `components/useGusStatus.ts` | Effective availability per organization; client cache 30 s |
| `lib/mapping.ts`, `lib/visibility.ts` | Customers company form mapping (names + primary address draft) and visibility rule |
| `lib/widget-config.ts` | Declarative config, `applyFieldMap`, gating, metadata validation |
| `components/GusLookupPanel.tsx` | NIP input + button + states |
| `components/GusLookupFormWidget.tsx`, `components/createGusLookupWidget.tsx` | Generic CrudForm widget and registration factory |
| `widgets/injection/company-lookup`, `widgets/injection/integration-status`, `widgets/injection-table.ts` | Built-in widgets and spot mapping |

DI: only `gusRegonHealthCheck` is registered (Awilix `asValue`). Routes resolve the platform services `integrationStateService` and `integrationCredentialsService` from the request container.

### Commands & Events
None. The package performs no writes and emits no events; the host form persists values through its own commands.

## UMES Extension Points
| Extension point | Used for |
|-----------------|----------|
| Integration registry (`integration.ts`) | Provider `gus_regon`: credentials schema, health check service, detail-page widget spot |
| Widget injection — CrudForm spot | `crud-form:customers.company` — the customers `companyForm` extension host (`customers/extension-points.ts`), used by the company create page and the company detail form |
| Widget injection — integration detail | `integrations.detail:gus_regon` (status line) |
| API routes (module-owned) | `api/lookup/route.ts`, `api/status/route.ts` |
| Module CLI (`cli.ts`) and setup hook | `configure-from-env`; `onTenantCreated` applies the env preset |
| Not used | Subscribers, workers, enrichers, interceptors, custom entities, custom fields, backend pages |

## Data Models
None — no entities and no migrations. `GusCompany` is a transient DTO (see API Contracts).

## API Contracts

### Company lookup
- `GET /api/gus_regon/lookup?nip=<nip>` — `requireAuth: true`, `requireFeatures: ['gus_regon.lookup']`, exports `openApi`
- Query (zod `lookupQuerySchema`): `nip` — string ≤ 32 chars; spaces, dashes and a `PL` prefix are normalized
- `200 { ok: true, company: GusCompany, candidates: GusCompany[] }`
- `200 { ok: false, reason: 'not_found' | 'unavailable' | 'not_configured' }` — fail-open (`not_configured` = integration disabled or production without key; `unavailable` also when the integration configuration cannot be read)
- `400 { error }` — missing/invalid NIP or user without an organization · `401 { error }` · `500 { error }` generic (error messages translated via `resolveTranslations`, `gus_regon.errors.*`)
- `GusCompany`: `{ nip, regon, name, street, buildingNumber, flatNumber, postalCode, city, voivodeship, county, commune, type, endDate, country: 'PL' }` — strings or `null`; `type` = BIR1 `Typ` (`P`, `F`, `LP`, `LF`)

### Status
- `GET /api/gus_regon/status` — `requireAuth: true`, `requireFeatures: ['gus_regon.lookup']`, exports `openApi`
- `200 { enabled, environment, hasApiKey, lookupAvailable, companyFormsRequested, companyFormsActive }` — booleans and the environment only, never the key
- `companyFormsActive = enabled && lookupAvailable && showOnCompanyForms && apiKey provided`
- `400` user without an organization · `401` · `500` generic

## Internationalization (i18n)
`i18n/{en,pl,de,es,ko}.json`, 40 keys under `gus_regon.*` (all five locales, `i18n:check-sync`): API error messages, widget title/descriptions, NIP label/placeholder, action/searching, invalid NIP, not found, unavailable, not configured, found, filled, nothing to fill, ceased, address label, field names, integration status lines. All UI strings go through `useT()`; route errors through `resolveTranslations()`. The ACL labels `auth.acl.features.gus_regon.lookup` and `auth.acl.modules.gus_regon` are added to `packages/core/src/modules/auth/i18n/*.json`, as for every provider.

## UI/UX
- **Built-in company card (opt-in).** Shown only when the integration is enabled, **Show on CRM company forms** is on and an API key is set. A stacked card "Fetch data from GUS REGON" above the fields: NIP input + **Fetch from GUS** (Enter triggers it).
- **States.** Invalid NIP → inline error, button disabled; searching → spinner; not found / unavailable / not configured → non-blocking `Alert`; success → "Found: {name} · REGON {regon}".
- **Fill rules.** Empty `legalName` and `displayName` are filled; on the create form, when no address exists, one primary address ("Registered office (GUS)") is added. One flash message lists the filled fields (warning variant when the entity ceased activity).
- **Spot.** The card is mapped only to the `companyForm` host (`crud-form:customers.company`). As a defense the widget additionally renders only on the company create route (operation `create`) or a company detail route (operation `update`) and never when person-only fields are present, so a future host reusing the spot cannot show it on a person form.
- **Integration page.** A status line explains whether the CRM card is on, or why not (switch off, API key missing, integration disabled).
- **Host forms.** A module declares `createGusLookupWidget({ id, nipField?, fields | apply, visible?, gate?, fieldLabels?, titleKey?, descriptionKey? })` in `widgets/injection/<name>/widget.ts` and maps it to its form spot in its own `widgets/injection-table.ts`. `fields` maps `name`, `nip`, `regon`, `street`, `streetLine`, `buildingNumber`, `flatNumber`, `postalCode`, `city`, `voivodeship`, `county`, `commune`, `country` onto form field ids (fill-empty-only). The factory validates the config and always requires the `gus_regon` and `integrations` modules. `GusLookupPanel` remains available for full control.
- Uses DS primitives only (`Input`, `Button`, `Label`, `Spinner`, `Alert`), semantic tokens (`text-status-error-text`), labelled controls, `apiCall`, `flash()`.

## Configuration
- Integration `gus_regon` (Settings → Integrations → GUS REGON):
  - `environment` — select `test` | `production` (Test = synthetic GUS data).
  - `apiKey` — secret; required for Production and for the CRM card; optional in Test for lookups (public GUS test key).
  - `showOnCompanyForms` — boolean, default off.
- Health check service: `gusRegonHealthCheck`.
- Optional env preset (documented in `apps/mercato/.env.example` and the create-app template): `OM_INTEGRATION_GUS_REGON_API_KEY` (trigger), `OM_INTEGRATION_GUS_REGON_ENVIRONMENT` (`test` default | `production`), `OM_INTEGRATION_GUS_REGON_SHOW_ON_COMPANY_FORMS` (default `false`), `OM_INTEGRATION_GUS_REGON_ENABLED` (default `true`), `OM_INTEGRATION_GUS_REGON_FORCE_PRECONFIGURE`. Applied in `onTenantCreated` and by `yarn mercato gus_regon configure-from-env --tenant <id> --org <id> [--force]`.
- ACL: `gus_regon.lookup` (default roles superadmin, admin, employee).
- Module enablement: listed in `apps/mercato/src/modules.ts`; shipped commented-out (opt-in) in the create-app template, like `gateway_tpay` (`scripts/template-sync.ts` `TEMPLATE_COMMENTED_MODULES`).

## Migration & Compatibility
- Additive per `BACKWARD_COMPATIBILITY.md`: a new package, new module id `gus_regon`, new ACL feature `gus_regon.lookup`, new API routes `/api/gus_regon/*`, new i18n keys, new CLI command and new injection-table entries on existing spots. No existing contract surface is renamed, removed or narrowed; no migrations.
- Versioned with the monorepo (`0.9.0`, `workspace:*` dependencies, published by `scripts/publish-packages.sh`); no changeset (core has none).
- Users of the official-modules preview (`@open-mercato/gus-regon` was never published to npm from official-modules) have nothing to migrate.

## Implementation Plan

### Phase 1: Lookup core
1. NIP validation; credentials → config.
2. BIR1 client, two-pass parser, fail-open lookup orchestration.
3. Unit tests with fixtures captured from the GUS test endpoint.

### Phase 2: Platform wiring
1. Scaffold (`scaffold-module`): package skeleton, `index.ts`, `acl.ts`, `setup.ts`.
2. `integration.ts` (credentials, health check), `di.ts`.
3. `GET /api/gus_regon/lookup` with `openApi`; route unit tests; TC-GUS-001–003.

### Phase 3: UI
1. `GusLookupPanel`, built-in company widget, injection table, i18n.
2. Visibility rule for the shared create-form spot; unit tests.

### Phase 4: Opt-in gating and host registration
1. `showOnCompanyForms` switch, `GET /api/gus_regon/status`, `useGusStatus`, integration status line; TC-GUS-004–005.
2. `createGusLookupWidget` + `GusFieldMap`; built-in widget moved onto the factory; unit tests.

### Phase 5: Port into core (2026-10-12)
1. Package moved to `packages/gus-regon` with core conventions (`gateway-tpay` layout, `0.9.0`, `workspace:*`, `ko` locale).
2. Spot mapping reduced to the `companyForm` host; write-only secrets handled in integration-test fixtures.
3. Logging via `createLogger` + `reportError`; provider env preset, CLI and `onTenantCreated` hook.
4. Wiring: `apps/mercato` module list and dependency, Dockerfile, create-app template (commented), `scripts/template-sync.ts`, `.env.example` (app + template), auth ACL labels, user guide page.
- Independent code review (core `om-code-review`) fixes: organization resolved with `resolveActiveOrganizationId` + `organizationScopeRequiredResponse()` in both routes; `reportError` in the lookup and health-check catches; translated health-check messages (`gus_regon.health.*`) with the raw reason in `details`; inline comments replaced by doc comments; TC-GUS-003 no longer calls GUS; `requires: ['integrations']`; types derived from the zod schemas; core service types in the routes; Cmd/Ctrl+Enter no longer captured by the NIP input; integration-definition unit test; docs note on `auth sync-role-acls`; 500 responses in OpenAPI.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/gus-regon/{package.json,build.mjs,watch.mjs,jest.config.cjs,tsconfig.json,README.md}` | Create | Package skeleton and docs |
| `packages/gus-regon/src/index.ts`, `src/modules/gus_regon/{index,acl,setup,di,integration,cli}.ts` | Create | Module, provider registration, env preset hook, CLI |
| `src/modules/gus_regon/lib/*.ts` | Create | Lookup core, status, mapping, widget config, env preset |
| `src/modules/gus_regon/data/validators.ts` | Create | zod schemas |
| `src/modules/gus_regon/api/{lookup,status}/route.ts` | Create | Routes |
| `src/modules/gus_regon/components/*` | Create | Panel, generic widget, factory, status hook |
| `src/modules/gus_regon/widgets/**` | Create | Built-in widgets + injection table |
| `src/modules/gus_regon/i18n/{en,pl,de,es,ko}.json` | Create | Translations |
| `src/modules/gus_regon/__tests__/**`, `__integration__/**` | Create | Unit + integration tests |
| `apps/mercato/src/modules.ts`, `apps/mercato/package.json`, `yarn.lock` | Modify | Enable the module in the monorepo app |
| `Dockerfile` | Modify | Copy the package manifest in all three stages |
| `packages/create-app/template/{package.json.template,src/modules.ts}`, `scripts/template-sync.ts` | Modify | Ship the package with scaffolds, disabled by default |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example` | Modify | Document the env preset |
| `packages/core/src/modules/auth/i18n/*.json` | Modify | ACL feature and module labels |
| `apps/docs/docs/user-guide/gus-regon.mdx`, `apps/docs/sidebars.ts` | Create/Modify | User guide |
| `.ai/specs/README.md` | Modify | Spec index row |

### Testing Strategy
- **Unit (15 suites, 104 tests):** env preset (trigger, defaults, flags, invalid environment, no overwrite without force, key never logged), NIP structure/checksum (with an independent reference implementation), config, SOAP envelope/headers, deadline covering a stalled request and a stalled body, MTOM extraction, SOAP faults, inner-document parsing (found / not found / session error / multi-record / leading zeros), record selection, lookup orchestration (endpoints and keys per environment, logout, fail-open on every failure, key never logged), mapping, visibility, field maps and config validation, status and gating, both routes (guards, scope, fail-open incl. unreadable configuration, 500 without leaks), health check (translated messages, reason in details), injection wiring, integration definition and DI registration.
- **Integration (Playwright):** see Integration Coverage.

## Integration Coverage
| Path | Kind | Test |
|------|------|------|
| `GET /api/gus_regon/lookup` — 401 / 400 missing NIP / 400 bad checksum | API | TC-GUS-001 |
| Integration `gus_regon` registered with `environment` (select), `apiKey` (secret), `showOnCompanyForms` (boolean) | API | TC-GUS-002 |
| `GET /api/gus_regon/lookup` — disabled → `not_configured`; production without key → `not_configured` (no call to GUS; rejected keys and outages are unit-tested) | API | TC-GUS-003 |
| `GET /api/gus_regon/status` — off by default; switch without key → off; switch + key → on; integration disabled → off; key not returned | API | TC-GUS-004 |
| `/backend/customers/companies/create` — no card with the switch off; card with switch + key; "Fetch from GUS" fills Display name / Legal name (lookup stubbed in the browser); no card on `/backend/customers/people/create` | UI | TC-GUS-005 |

All tests are self-contained: they snapshot the integration state and the non-secret credentials and restore them in `finally` (TC-GUS-005: `afterEach`, which still runs after a test timeout). The API key is write-only in the credentials API (`secretFieldsConfigured`), so a test skips when a key is already configured instead of overwriting a value it cannot restore. No test calls GUS: TC-GUS-003 only exercises paths answered before the upstream call, and TC-GUS-005 stubs the lookup in the browser.

## Implementation Status
| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phases 1–4 (official-modules) | Done | 2026-09-30 – 2026-10-06 | Lookup core, platform wiring, UI, opt-in gating + host registration; reviewed with the official-modules `code-review` skill; manual QA, Verdaccio smoke test and Playwright 7/7 in the official-modules sandbox |
| Phase 5 — Port into core | Done | 2026-10-12 | Typecheck, 104 unit tests, `yarn generate`, CI gate list below; independent code review fixes applied |
| Playwright TC-GUS-001–005 against core | Pending | — | Runs in CI (`ephemeral-integration`); local run on the monorepo app before marking ready for review |
| Manual QA on core | Pending | — | Same checklist as Phase 4: status line states, company create/edit card, fill-empty-only, checksum error, no card on person forms, switch off, integration disabled |

## Risks & Impact Review

### Data Integrity Failures
- The package writes nothing. An interrupted lookup leaves the form untouched; the NIP input is disabled while a lookup runs, so a stale answer cannot fill a different NIP.

### Cascading Failures & Side Effects
- GUS unavailable → `unavailable`, manual entry continues. Login and search have an 8 s deadline each (headers and body); logout is fire-and-forget. No events, subscribers or workers.

### Tenant & Data Isolation Risks
- Credentials and state are resolved per `(active organization, tenantId)` through the platform services, with the organization resolved by `resolveActiveOrganizationId`; the env preset writes only to the scope passed by `onTenantCreated` or the CLI arguments. Routes read no tenant records and return only public register data. The client status cache is per browser session and holds booleans only.

### Migration & Deployment Risks
- None: additive routes and widgets, no migrations. Deployments that install the package see no CRM change until the switch is on and a key is set.

### Operational Risks
- GUS rate limits and outages are external; failures are logged as warnings without the key and reported through `reportError`. The health check on the integration page reports connectivity.

### Risk Register

#### GUS outage or slow responses
- **Scenario**: BIR1 is down or slow.
- **Severity**: Low
- **Affected area**: Lookup card only.
- **Mitigation**: Per-call deadline, fail-open `unavailable`, non-blocking alert.
- **Residual risk**: Up to ~16 s before the alert; acceptable for an explicit button.

#### Wrong record for multi-record answers
- **Scenario**: A NIP returns the entity and its local units.
- **Severity**: Low
- **Affected area**: Filled name/address.
- **Mitigation**: Entity (`P`/`F`) over local units (`LP`/`LF`), active over ceased; all candidates returned; name and REGON shown before saving.
- **Residual risk**: No picker UI in v1.

#### API key exposure
- **Scenario**: The key leaks via responses, logs or the client.
- **Severity**: High
- **Affected area**: Organization's GUS account.
- **Mitigation**: Encrypted platform credentials, server-side use only, never logged (unit tests) or returned (unit tests, TC-GUS-003/004).
- **Residual risk**: None identified.

#### Personal data of sole traders
- **Scenario**: For natural-person businesses (`Typ F`) the name is personal data.
- **Severity**: Medium
- **Affected area**: Host forms that store the filled values.
- **Mitigation**: Data comes from a public statutory register, is fetched only on an explicit operator action and is not stored by the package; persistence follows the host module's PII/encryption rules.
- **Residual risk**: Hosts must apply their own retention policy.

#### Test data used in production
- **Scenario**: An organization keeps the Test environment and fills synthetic data.
- **Severity**: Low
- **Affected area**: Filled values.
- **Mitigation**: Required environment field labelled "synthetic data"; production never uses the public test key.
- **Residual risk**: Operator error remains possible.

## Spec Checklist Coverage
| Checklist area | Answer |
|----------------|--------|
| 1. Design logic & phasing | MVP and deferred work explicit (TLDR); user stories map to API/UI/Configuration; phases incremental and tested |
| 2. Architecture & isolation | No ORM links (no entities); package placement `packages/gus-regon`; DI via Awilix (`asValue`); no events/subscribers/workers |
| 3. Data integrity & security | No writes (atomicity N/A); zod on all inputs; guards declared; secrets excluded from logs/responses/errors; XML values escaped in SOAP bodies; NIP URL-encoded; React renders text only (no raw HTML); no SQL (no queries); PII note in Risk Register |
| 4. Commands, events & naming | N/A — no mutations, commands or events. Feature `gus_regon.lookup` follows `<moduleId>.<action>`. Module id `gus_regon` is a provider name (precedent `carrier_inpost`, `financial_pl`), not a plural entity collection |
| 5. API, UI & compatibility | Contracts complete with errors; both routes export `openApi`; DS primitives + CrudForm injection; i18n for all strings; pagination N/A (single-record lookups); compatibility in Migration & Compatibility |
| 6. Performance, cache & scale | Point lookups only, no DB queries/indexes; one upstream lookup per explicit click; `/status` cached client-side 30 s (per session, booleans only, no tenant data); no server cache — low volume, freshness preferred |
| 7. Risks & anti-patterns | Concrete scenarios with severity, mitigation, residual risk; no boilerplate CRUD, no speculative phases in the MVP plan |

## Final Compliance Report — 2026-10-12

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — Where to Put Code (provider package), Data & Security, UI & HTTP, Code Quality, Design System Rules, PR Workflow
- `packages/core/AGENTS.md` — Module Setup (provider env preconfiguration), Widget Injection, Cross-Module Coupling, Access Control
- `packages/core/src/modules/integrations/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`
- `.ai/skills/om-integration-builder/SKILL.md`, `om-spec-writing`, `om-implement-spec`, `om-integration-tests`, `om-code-review`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | External integration provider in a dedicated workspace package | Compliant | `packages/gus-regon` |
| root AGENTS.md | Validate all inputs with zod in `data/validators.ts` | Compliant | `lookupQuerySchema`; response schemas for `openApi` |
| root AGENTS.md | Tenant/organization scoping | Compliant | No DB queries; credentials and state per active organization (`resolveActiveOrganizationId`) + tenant |
| root AGENTS.md | Declarative guards `requireAuth`, `requireFeatures` | Compliant | Both routes; widgets declare `features` |
| core AGENTS.md | API routes export `openApi` | Compliant | Both routes (GET only — no mutation guard needed) |
| core AGENTS.md | `defaultRoleFeatures` for every feature in `acl.ts` | Compliant | `gus_regon.lookup` → superadmin, admin, employee |
| core AGENTS.md | Provider env preconfiguration inside the provider (`setup.ts` + helper/CLI) | Compliant | `lib/preset.ts`, `onTenantCreated`, `configure-from-env` |
| root AGENTS.md | i18n: `useT()` / `resolveTranslations()`, no hardcoded strings | Compliant | 40 keys × 5 locales incl. API errors; `[internal]` prefix on internal messages |
| root AGENTS.md | `apiCall`, never raw `fetch` in UI | Compliant | Server-side BIR1 calls use `fetchWithTimeout` |
| root AGENTS.md | Logging via `createLogger`; a catch that records an error also calls `reportError` | Compliant | Routes, lookup, health check, setup hook and CLI |
| root AGENTS.md | No `any`; boolean parsing via shared helpers | Compliant | `parseBooleanToken` (preset), `parseBooleanFromUnknown` (credentials) |
| root AGENTS.md | DS: semantic tokens, existing primitives, labelled controls | Compliant | `Alert`, `Input`, `Button`, `Label`, `Spinner`; `text-status-error-text` |
| root AGENTS.md | Never commit credentials | Compliant | Only the public GUS test key (documented as public) |
| BACKWARD_COMPATIBILITY.md | Contract surfaces additive only | Compliant | See Migration & Compatibility |
| .ai/specs/AGENTS.md | Required sections, risks, changelog; integration coverage + tests in the same change | Compliant | Integration Coverage; TC-GUS-001–005 |
| .ai/qa/AGENTS.md | Module-local `__integration__/`, shared helpers from `@open-mercato/core/helpers/integration/*`, self-contained, no per-test timeouts | Compliant | |
| create-app AGENTS.md | Template parity (`.env.example`, module list) | Compliant | `yarn template:sync` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No entities; `GusCompany` matches `lib/types.ts` and `data/validators.ts` |
| API contracts match UI/UX section | Pass | Widget handles every `reason`; status fields drive gating and the status line |
| Risks cover all write operations | Pass | Only the env preset writes (platform credentials/state services, idempotent, no overwrite without force) |
| Commands defined for all mutations | Pass | No domain mutations |
| Cache strategy covers all read APIs | Pass | `/status` client cache 30 s; `/lookup` uncached by design |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-10-12
- Ported from official-modules (SPEC-010, PR #56) into core as `packages/gus-regon` after official-modules was deprecated (#58): core package conventions (`0.9.0`, `workspace:*`, `ko` locale), spot mapping reduced to the customers `companyForm` host, write-only secrets in integration-test fixtures, `createLogger` + `reportError`, provider env preset + `configure-from-env` CLI + `onTenantCreated`, app/Docker/template/env wiring, auth ACL labels, user guide page.

### 2026-09-30 (official-modules SPEC-010)
- Skeleton spec (TLDR + Open Questions Q1–Q5) per `spec-writing`. Open Questions resolved by the requester: Q1 standalone provider package; Q2 `@open-mercato/gus-regon` / `gus_regon`, category `other`, no hub; Q3 customers company form + host mappings; Q4 `DaneSzukajPodmioty` only; Q5 `fast-xml-parser`.
- Full specification; Phases 1–3 implemented.
- Review fixes: widget hidden in person forms and the add-person dialog, OM 0.6.x edit spot `customers.company`, credentials scope `auth.orgId`, one deadline covering the response body, logout not awaited, robust panel error states, single combined flash, REGON shown, NIP structure check.

### 2026-10-05 (official-modules SPEC-010)
- Phase 4: CRM card opt-in (`showOnCompanyForms`, default off, effective only with an API key), `GET /api/gus_regon/status`, integration status line, widgets hidden until the lookup is usable.
- Declarative host registration: `createGusLookupWidget` + `GusFieldMap`; built-in company widget uses the factory.
- Boolean parsing via `parseBooleanFromUnknown`; TC-GUS-004–005; Integration Coverage, UMES Extension Points, Implementation Status and checklist coverage sections.
- TC-GUS-005 uses the core `login` helper (`@open-mercato/core/helpers/integration/auth`) and locates CrudForm fields by `data-crud-field-id`.
- Local verification: manual QA, Playwright TC-GUS-001–005 (7/7) and the Verdaccio smoke test (`publish:preview` + `module add @preview`) passed; Implementation Status updated.
- Code-review fixes: TC-GUS-005 restores state in `afterEach` and waits for the person form; expected GUS outcomes logged without "failed" (sandbox dev runner flags such lines as runtime errors); deadline also covers the response body, translated API errors, fail-open on unreadable configuration, `^0.6.0` peers, version `0.0.0`, core integration-test helpers, `titleKey`/`descriptionKey`.

### Review — 2026-10-05
- **Reviewer**: Agent (independent code review + spec checklist pass)
- **Security**: Passed — key never logged/returned (tests), guards on both routes, inputs zod-validated, SOAP values XML-escaped
- **Performance**: Passed — point lookups, per-call deadline, no DB access
- **Cache**: Passed — `/status` client-only cache (30 s, booleans), no tenant data cached
- **Commands**: Passed — N/A (no mutations)
- **Risks**: Passed — PII note for sole traders added
- **Verdict**: Approved

### Review — 2026-10-05 (code-review skill)
- **Reviewer**: Agent (`code-review` + `auto-review-pr` auto-detections, CI gates)
- **CI gates**: `yarn install --immutable`, `build:packages`, `generate`, `check:dep-versions`, `i18n:check-sync:packages`, `typecheck`, `test` — pass. `i18n:check-usage:packages` and `platform:sync --check` fail on a clean `develop` as well (pre-existing; this package adds no missing keys).
- **Fixed**: body read now raced against the per-call deadline (`fetchWithTimeout` detaches the caller's signal after headers); API error messages translated (`gus_regon.errors.*`); lookup fails open when the configuration cannot be read; peer range `^0.6.0`, package version `0.0.0` + minor changeset (first release 0.1.0, matches `integration.ts`); `license` field; integration tests on core helpers without per-test timeout overrides; widget config `titleKey`/`descriptionKey`; built-in field labels referenced statically; unused `invalidateGusStatus` removed; REGON wording (shown, not filled).
- **Accepted as-is (Low)**: no outbound rate limit (point lookups behind `gus_regon.lookup`); 30 s client status cache not keyed by organization (server re-checks on lookup); status-line precedence.
- **Verdict**: Approved
