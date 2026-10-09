# Execution Plan — Tpay hosted PLN payment sessions

- **Date:** 2026-10-09
- **Slug:** tpay-hosted-pln-payment-sessions
- **Source spec:** `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`
- **Pre-implementation analysis:** `.ai/specs/analysis/ANALYSIS-2026-08-01-tpay-hosted-pln-payment-sessions.md`
- **Base branch:** `develop`
- **Branch:** `mtytula/tpay-spec-implementation` (pushed to the `fork` remote; PR opened in `mtytula/open-mercato` against `develop`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Scaffold the gateway-tpay package with module metadata, ACL, setup and locales | dispatch:cheap | done | 7ec44b8a3 |
| 1 | 1.2 | Add the bounded Tpay HTTP client | dispatch | done | self |
| 1 | 1.3 | Add the Tpay status map and v1 gateway adapter | dispatch:capable | todo | — |
| 1 | 1.4 | Add the integration definition, callback URL validation, health check and DI registration | dispatch | todo | — |
| 1 | 1.5 | Add the Tpay env preset, configure-from-env CLI and tenant setup hook | dispatch:cheap | todo | — |
| 1 | 1.6 | Forward payer email and name from checkout submit to the session metadata | inline | todo | — |
| 1 | 1.7 | Wire gateway-tpay into the app, create-app template, Dockerfile and ACL catalog | dispatch:capable | todo | — |
| 1 | 1.8 | Add Tpay API integration tests | dispatch | todo | — |
| 1 | 1.9 | Add the Tpay user guide and align the spec with the implementation | inline | todo | — |

## Goal

Ship `@open-mercato/gateway-tpay` (module `gateway_tpay`, provider key `tpay`): PLN hosted-redirect sessions and status reads through the existing `GatewayAdapter`, disabled by default, with encrypted tenant credentials, health check, env preset/CLI, five-locale catalogs, and CI-runnable tests.

## Scope

- New workspace package `packages/gateway-tpay`.
- Additive checkout change: `metadata.customerEmail` / `metadata.customerName` in `createPaymentSession`.
- Repository wiring required by CI (app, create-app template, `scripts/template-sync.ts`, `Dockerfile`, peer-deps allowlist if needed, auth ACL i18n catalog).
- Docs: user guide + sidebar entry.

## Non-goals

- Notification/webhook settlement (`.ai/specs/2026-07-26-tpay-full-integration.md`), scheduled reconciliation, refunds/cancel/capture, EUR, channel selection, BLIK/cards/wallets, storefront code.
- Any shared-type change in `@open-mercato/shared` (payer data travels in `metadata`).
- `.github/workflows/package-previews.yml` (needs maintainer approval) — the package is left out of preview publishing for now.
- Database migrations (none needed).

## Risks

- **`pay` body shape unverified** — the OpenAPI marks `pay` required; no sandbox credentials in this run. The client sends the hosted form without `pay`; the contract-test fixture pins the body and the spec keeps the sandbox confirmation gate before any tenant enables the provider.
- **Integration tests cannot reach Tpay** — Playwright tests run against the real app, so they cover configuration and the pre-network rejection paths (missing payer data, non-PLN) only. The redirect → `captured` path is covered by unit tests with mocked `fetch` and by manual sandbox acceptance.
- **Credential/descriptor labels are plain strings** — the platform renders `IntegrationDefinition` and descriptor labels verbatim (`packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx:314`), as Stripe does. Module title/description, errors and health messages use `gateway_tpay.*` locale keys; field labels stay English like `gateway_stripe`.
- **Overlap with PR #6047** — same `customerEmail` metadata key in checkout submit; a later rebase is trivial.

## External References

None (`--skill-url` not supplied). Tpay contract facts come from the official Tpay Open API document embedded at `https://api.tpay.com` and `https://docs-api.tpay.com/en/first-steps/authorization/`.

## Implementation Plan

### Phase 1 — Tpay hosted PLN provider foundation

#### 1.1 Scaffold the gateway-tpay package with module metadata, ACL, setup and locales

- Copy the package scaffolding pattern of `packages/gateway-stripe` (`package.json`, `build.mjs`, `watch.mjs`, `jest.config.cjs`, `tsconfig.json`, `src/index.ts`): name `@open-mercato/gateway-tpay`, version equal to `packages/shared/package.json`, deps only what is imported (`@open-mercato/core` `workspace:*`; no `@open-mercato/ui`, no `@open-mercato/queue`, no provider SDK — use global `fetch`), peerDeps `@open-mercato/shared` (+ `@mikro-orm/postgresql` only if `core` imports require it, mirror Stripe), repository directory `packages/gateway-tpay`.
- Module `src/modules/gateway_tpay/`: `index.ts` metadata (`id: 'gateway_tpay'`, title `Tpay Payment Gateway`, description), `acl.ts` (`gateway_tpay.view` dependsOn `payment_gateways.view`; `gateway_tpay.configure` dependsOn `gateway_tpay.view`, `payment_gateways.manage`), `setup.ts` with `defaultRoleFeatures` for superadmin/admin (no `onTenantCreated` yet — Step 1.5 adds it).
- `i18n/{en,pl,de,es,ko}.json` with `gateway_tpay.title`, `gateway_tpay.description`, `gateway_tpay.feature.view`, `gateway_tpay.feature.configure`, and the error keys used later: `gateway_tpay.errors.unsupportedOperation`, `gateway_tpay.errors.currencyNotSupported`, `gateway_tpay.errors.invalidAmount`, `gateway_tpay.errors.payerEmailRequired`, `gateway_tpay.errors.payerNameRequired`, `gateway_tpay.errors.providerUnavailable`, `gateway_tpay.errors.invalidNotificationUrl`, `gateway_tpay.health.healthy`, `gateway_tpay.health.unhealthy`, `gateway_tpay.description.fallback`. Real Polish translations; de/es/ko real translations where straightforward.
- Test: `__tests__/acl-dependencies.test.ts` mirroring Stripe's.
- Run `yarn install` so `yarn.lock` gains the workspace entry; commit the lockfile change.

#### 1.2 Add the bounded Tpay HTTP client

- `lib/tpay-client.ts`: `TPAY_BASE_URLS = { production: 'https://api.tpay.com', sandbox: 'https://openapi.sandbox.tpay.com' }`; `resolveTpayEnvironment(value)` accepts only `sandbox|production`.
- `requestAccessToken({ clientId, clientSecret, environment })` → `POST {base}/oauth/auth`, `application/x-www-form-urlencoded`, returns `access_token`; no caching.
- `createTransaction(token, body)` → `POST {base}/transactions` JSON; `getTransaction(token, transactionId)` → `GET {base}/transactions/{encodeURIComponent(id)}`.
- Bounds: `AbortSignal.timeout(10_000)`, response body read capped at 256 KiB (fail when exceeded), JSON parsed defensively (zod schemas for the fields used: `transactionId`, `title`, `status`, `transactionPaymentUrl`, `amount`, `currency`, `payments.amountPaid`, `hiddenDescription`).
- `assertTpayPaymentUrl(url, environment)` — HTTPS and host ending in `.tpay.com` (or exactly `tpay.com`), else throw.
- Errors: a typed `TpayClientError` carrying HTTP status and a bounded, secret-free message (never include tokens, client secret, or payer data). `[internal]` prefix on internal messages.
- Tests with mocked global `fetch`: OAuth success/failure, form-encoded body, Bearer header, timeout/abort, oversized body, malformed JSON, 4xx/5xx mapping, URL origin check, base URL per environment, no secrets in error messages.

#### 1.3 Add the Tpay status map and v1 gateway adapter

- `lib/status-map.ts`: `mapTpayStatus(status)` per spec table (`pending→pending`, `paid→captured`, `correct→captured`, `refund→refunded`, `canceled→cancelled`, other→`unknown`).
- `lib/amount.ts` (or inside adapter): integer-grosze rounding half-up, reject non-finite/≤0 → `CrudHttpError(422)` with `gateway_tpay.errors.invalidAmount`.
- `lib/adapters/v1.ts`: `tpayAdapterV1: GatewayAdapter` with `providerKey: 'tpay'`.
  - `createSession`: PLN only (`currencyNotSupported`, 422) → amount → payer (`metadata.customerEmail` valid email, `metadata.customerName` non-empty ≤ 255 chars; 422 errors) → resolve credentials (`clientId`, `clientSecret`, `environment`, optional `notificationUrl`) → OAuth → `createTransaction` with body from the spec (no `pay`; `lang: 'pl'`; `hiddenDescription: paymentId`; `callbacks.payerUrls.success/error` from `successUrl`/`cancelUrl` when present; `callbacks.notification.url` only when a validated `notificationUrl` is configured — validation helper lands in 1.4, so 1.3 reads an already-validated value via a small injected/imported function stub kept in `lib/callback-url.ts` created here with the full rules) → validate `transactionId` + `transactionPaymentUrl` → return `{ sessionId: transactionId, status: 'pending', redirectUrl, clientSession: { type: 'redirect', redirectUrl }, providerData: { title, providerStatus } }`.
  - `getStatus`: OAuth → `getTransaction` → `{ status: mapTpayStatus, amount, amountReceived: payments.amountPaid ?? 0, currencyCode: currency, providerData: { providerStatus } }`.
  - `mapStatus` delegates to `mapTpayStatus`.
  - `capture`/`refund`/`cancel` throw `CrudHttpError(422, { error: '<translated unsupportedOperation>' })` (resolve translation via `resolveTranslations` from `@open-mercato/shared/lib/i18n/server` if usable in this context, otherwise the established pattern in core gateway routes — check before choosing; document choice).
  - `verifyWebhook` throws `new Error('[internal] Tpay notifications are not supported yet')`.
  - Provider failures → `CrudHttpError(502)` with `providerUnavailable` (bounded message), never leaking provider body.
- `lib/callback-url.ts`: `resolveTpayNotificationUrl({ credential, environment })` — HTTPS (http allowed only in sandbox), no userinfo/query/fragment, production port 443 only, sandbox ports 80/8080/443; returns `null` when unset; throws `CrudHttpError(422, invalidNotificationUrl)` when set but invalid. Never derived from request origin/Host.
- Tests: status map exhaustiveness, amount rounding (e.g. 0.1+0.2, 10.005), PLN/payer rejections make **no** `fetch` call, request body snapshot fixture (pins the hosted body incl. absence of `pay`), notification URL included/omitted, redirect URL origin rejection, getStatus mapping, unsupported members, verifyWebhook throw, callback URL validation matrix.

#### 1.4 Add the integration definition, callback URL validation, health check and DI registration

- `integration.ts`: `IntegrationDefinition` (`id: 'gateway_tpay'`, `category: 'payment'`, `hub: 'payment_gateways'`, `providerKey: 'tpay'`, `package: '@open-mercato/gateway-tpay'`, docsUrl `https://docs-api.tpay.com`, tags `['bank-transfer','pay-by-link','blik','pln']`, `apiVersions: [{ id: 'v1', label: 'Tpay Open API', status: 'stable', default: true }]` only if the hub requires versions for `registerGatewayAdapter` — mirror Stripe's usage), credentials per spec table (`clientId` text, `clientSecret` secret, `environment` select sandbox/production, `notificationUrl` url optional, `notificationSecurityCode` secret optional), `healthCheck: { service: 'tpayHealthCheck' }`; export `integrations`, `bundles`, `bundle` like Stripe.
- `lib/health.ts`: `tpayHealthCheck.check(credentials)` — validates required fields and notification URL, requests an OAuth token; returns `healthy`/`unhealthy` with bounded secret-free message and details (`environment`, `notificationUrlConfigured`).
- `di.ts`: `registerGatewayAdapter(tpayAdapterV1, { version: 'v1' })` (match the hub's version semantics), `registerPaymentGatewayDescriptor({ providerKey: 'tpay', label: 'Tpay', sessionConfig: { fields: [], supportedCurrencies: ['PLN'], supportedPaymentTypes: [{ value: 'pay_by_link', label: 'Online transfer / BLIK (Tpay hosted page)' }], presentation: 'redirect' } })` (check descriptor type for required keys), register `tpayHealthCheck` via `asValue`. No webhook handler.
- Tests: integration definition shape (credential keys/types), descriptor registration (redirect, PLN only, no embedded renderer), health check healthy/unhealthy with mocked fetch, invalid notification URL → unhealthy without network.

#### 1.5 Add the Tpay env preset, configure-from-env CLI and tenant setup hook

- `lib/preset.ts` mirroring Stripe: env keys `OM_INTEGRATION_TPAY_CLIENT_ID`, `_CLIENT_SECRET`, `_ENVIRONMENT` (default `sandbox`, validated), `_NOTIFICATION_URL`, `_NOTIFICATION_SECURITY_CODE`, `_ENABLED` (default true), `_FORCE_PRECONFIGURE`; client ID + secret required together; skip when existing credentials/state unless force; no legacy aliases.
- `cli.ts`: `configure-from-env` + `help` commands (`yarn mercato gateway_tpay configure-from-env --tenant <id> --org <id> [--force]`).
- `setup.ts`: add `onTenantCreated` applying the preset (warn on failure, like Stripe).
- Tests: `__tests__/preset.test.ts` (none/partial/complete env, invalid environment, force semantics, enabled flag, no secrets in errors).

#### 1.6 Forward payer email and name from checkout submit to the session metadata

- `packages/checkout/src/modules/checkout/api/pay/[slug]/submit/route.ts`: add `customerEmail` (from `collectedCustomerData.email`) and `customerName` (trimmed `firstName lastName`, omitted when empty) to `createPaymentSession` `metadata`, only when present. No inline comments.
- Unit test in checkout covering the forwarded metadata (find the closest existing submit-route test or add a focused helper test).

#### 1.7 Wire gateway-tpay into the app, create-app template, Dockerfile and ACL catalog

- `apps/mercato/package.json` dependency; `apps/mercato/src/modules.ts` entry `{ id: 'gateway_tpay', from: '@open-mercato/gateway-tpay' }` next to Stripe; `apps/mercato/.env.example` commented `OM_INTEGRATION_TPAY_*` block after the Stripe block.
- Create-app template: `packages/create-app/template/package.json.template`, `template/src/modules.ts` (module present but commented — add `gateway_tpay` to `TEMPLATE_COMMENTED_MODULES` in `scripts/template-sync.ts` with the exact source/commented text pair, reason: awaiting live sandbox acceptance), `template/.env.example`, `SYNC_INTERNAL_PACKAGE_KEYS` in `scripts/template-sync.ts`.
- `Dockerfile`: three `COPY packages/gateway-tpay/package.json` lines mirroring Stripe (deps, build, runner stages).
- `scripts/package-peer-deps-allowlist.json`: add entries only if `node scripts/check-package-peer-deps.mjs` (or the configured script) reports violations for the new package; reuse Stripe's reason strings.
- `packages/core/src/modules/auth/i18n/{en,pl,de,es,ko}.json`: `auth.acl.features.gateway_tpay.view`, `auth.acl.features.gateway_tpay.configure`, `auth.acl.modules.gateway_tpay`.
- Run `yarn generate`, `yarn template:sync` (check mode), the version-alignment and peer-deps checks, and the create-app parity tests (`template-modules-parity`, `module-facts-build`, `agent-surface-coverage`); fix until green.

#### 1.8 Add Tpay API integration tests

- `packages/gateway-tpay/src/modules/gateway_tpay/__integration__/` with `meta.ts` (mirror payment_gateways) and `TC-TPAY-001.spec.ts`… using `@open-mercato/core` integration helpers:
  - save Tpay credentials for the test org via the integrations API (sandbox env, dummy client), enable the integration, assert credential secrets are not returned;
  - create a session via the admin payment-gateways sessions API with `providerKey: 'tpay'` and no payer → 422 with no provider call;
  - non-PLN currency → 422;
  - cleanup: remove credentials/state created in the test (`finally`).
- Gate the file on the module being enabled (metadata gate pattern used by other provider tests); never require live Tpay.
- Verify discovery with `npx playwright test --config .ai/qa/tests/playwright.config.ts --list`.

#### 1.9 Add the Tpay user guide and align the spec with the implementation

- `apps/docs/docs/user-guide/tpay-payments.mdx` (setup in Tpay Merchant Panel, credentials, environment, notification URL note, limitations: PLN only, no notifications yet, no refunds/cancel, sandbox acceptance pending) + `apps/docs/sidebars.ts` entry next to Stripe.
- Spec update: integration tests live in the module `__integration__` folder (not `.ai/qa/tests/`), label/i18n decision for credential fields, `package-previews.yml` deferral, implementation notes, changelog entry; keep `Status` as `in-progress` (sandbox acceptance outstanding).
