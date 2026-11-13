# Pre-Implementation Analysis: Tpay Hosted PLN Payment Sessions

- **Spec:** `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`
- **Analyzed against:** `origin/develop` @ `3b02dd5ee` (2026-10-09)
- **External contract source:** Tpay Open API (OpenAPI 3.0 embedded at `https://api.tpay.com`), Tpay authorization docs (`https://docs-api.tpay.com/en/first-steps/authorization/`)
- **Related work:** PR #6047 `feat(gateway-autopay)` (same provider shape, open, changes requested)

## Executive Summary

The spec is architecturally sound and fully additive — no backward-compatibility violations. It is **not ready to implement as written**: it leaves the Tpay request shape underspecified in ways the real API and the current hub contracts make blocking. Tpay requires `payer.email` and `payer.name`, but `CreateSessionInput` carries no payer data and checkout does not forward it. The required `GatewayAdapter.verifyWebhook` method and the unsupported-operation error convention are undefined. The status map, credential fields, environments and locale set do not match reality. Recommendation: **needs spec updates first** (small, targeted edits; no redesign).

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Auto-discovery file conventions | New module files only (`integration.ts`, `di.ts`, `acl.ts`, `setup.ts`, `cli.ts`, `index.ts`). | None | — |
| 2 | Type definitions & interfaces | None if payer data travels in `CreateSessionInput.metadata`. Adding a typed optional `payer` field to `CreateSessionInput` would be ADDITIVE-ONLY (allowed). | None / Info | Prefer metadata convention (see Gap C1); if a typed field is chosen, keep it optional. |
| 3 | Function signatures | None. | None | — |
| 4 | Import paths | None. | None | — |
| 5 | Event IDs | None added; reuses `payment_gateways.payment.*`. | None | — |
| 6 | Widget spot IDs | None (Stripe's config widget is not required for Tpay). | None | — |
| 7 | API route URLs | No new route. Checkout submit gains extra `metadata` keys (internal payload, not response). | None | — |
| 8 | Database schema | No change. | None | — |
| 9 | DI service names | New `tpayHealthCheck` key. | None | — |
| 10 | ACL feature IDs | New `gateway_tpay.view`, `gateway_tpay.configure`. | None | — |
| 11 | Notification type IDs | None. | None | — |
| 12 | CLI commands | New `gateway_tpay configure-from-env`. | None | — |
| 13 | Generated file contracts | Regenerated registries only (`yarn generate`). | None | — |

### Missing BC Section

Present and accurate.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Phasing | Low — one PR is intended. | State explicitly "single phase"; break the Implementation Plan into loop-sized steps (see Remediation). |
| Integration Test Coverage (CI-runnable) | High — the only E2E listed needs live sandbox credentials, which CI does not have; `.ai/qa/AGENTS.md` requires self-contained integration tests in the same change. | Add API-level integration tests against a mocked Tpay HTTP layer, plus a separate manual sandbox acceptance step. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| API Contracts → `createSession` | "payer data required by the existing flow" — the existing flow supplies none (Gap C1). Request body not enumerated; `pay` object handling unspecified (Gap C2). | Enumerate the exact Tpay `POST /transactions` body. |
| API Contracts → `getStatus` | Status list not enumerated (Gap C3). | Add explicit mapping table. |
| Proposed Solution → package components | No credential field list; no environment selector (Gap C5). | Add credential field table. |
| Internationalization | Says en/pl/de/es; repo requires **en, pl, de, es, ko** (`scripts/i18n-check-sync.ts:24-25`). | Fix to five locales, including the auth ACL catalog. |
| Session creation → amount | Says "canonical decimal amount"; actual `CreateSessionInput.amount` is a JS `number` (`types.ts:145-163`), Tpay expects `number` (`float`, > 0). | Specify: round half-up to 2 decimals via integer grosze, reject non-finite/≤0. |
| UI/UX → "one redirect renderer" / "hosted redirect descriptor" | No generic redirect renderer exists; `PayPage` redirects whenever no embedded renderer is set (`PayPage.tsx:1692-1696, 1960-1979`). | Register a descriptor with `presentation: 'redirect'` and no embedded renderer; return `clientSession: { type: 'redirect', redirectUrl }`. |
| Implementation Plan | Omits repo-wide wiring that CI enforces (see Gap I1). | Add the wiring checklist. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| Cache via DI, tenant-scoped (`packages/cache/AGENTS.md`) | Edge cases → "OAuth expires: refresh once" implies token caching, strategy unspecified. | Either no caching in v1 (OAuth per operation; `expires_in` is 7200 s, cost is one extra call) or DI cache keyed by `tenant:<id>`/`org:<id>` + credential fingerprint. Recommend no cache in v1. |
| Provider credentials must never control cross-origin requests (lesson `provider-credentials-must-never-control-authenticated`) | `tpay-client.ts` "sandbox/production base URLs". | Base URL chosen from a fixed enum (`production` → `https://api.tpay.com`, `sandbox` → `https://openapi.sandbox.tpay.com`), never a credential-supplied URL; reject `transactionPaymentUrl` whose origin is not an allowlisted Tpay host. |
| `[internal]` prefix / i18n for user-facing errors | Unsupported ops, PLN rejection, missing payer email. | Merchant/payer-visible errors via `gateway_tpay.errors.*`; internal ones `[internal]` (PR #6047 review finding m-B). |
| Integration tests ship with the feature (`AGENTS.md` → Documentation and Specifications) | Testing Strategy. | See Missing Sections. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Payer email/name unavailable to adapter (C1) | Every Tpay `POST /transactions` fails validation; provider unusable from checkout. | Checkout forwards `customerEmail`/`customerName` via `metadata` (same convention as PR #6047); adapter fails closed with a translated error when missing (admin `/sessions` route has no payer). Coordinate with #6047 to avoid a conflicting checkout edit. |
| Create-before-commit duplicate | Tpay has no idempotency key (OpenAPI: zero mentions). Hub already guards local re-entry via `GatewaySessionInitialization` when `idempotencyKey` is present (`gateway-service.ts:451-530`); residual window is provider-side only. | Keep spec's residual-risk statement; adapter uses the hub's `idempotencyKey` only for logging/correlation. Optional: on ambiguity, look up by `hiddenDescription` via `GET /transactions` (verify filter support in sandbox first). |
| Misread `paid` vs `correct` | Mapping `paid` to non-captured leaves paid orders pending. | Map both to `captured` (see C3) and confirm with one sandbox run. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `pay` marked required in OpenAPI (C2) | Hosted redirect request rejected if `pay` omitted or sent in wrong shape. | Pin the exact body from the internal PoC that completed a sandbox payment; add a contract test fixture. |
| Unsupported operations surface as HTTP 502 | Any non-`CrudHttpError` throw becomes 502 (`api/capture/route.ts:77-82`), so admin "Refund"/"Cancel" shows a gateway failure. | Throw `CrudHttpError(422, { error: t('gateway_tpay.errors.unsupportedOperation') })` (or the shared error helper used by core routes). |
| Template/scaffold wiring | CI failures seen repeatedly on #6047 (peer deps, template parity, fact-sheet coverage, version alignment, Dockerfile). | Follow checklist I1; keep module commented in the create-app template via `TEMPLATE_COMMENTED_MODULES` until sandbox acceptance. |
| Overlap with PR #6047 in checkout submit route | Merge conflict / double implementation of `customerEmail`. | Reuse the exact key name `customerEmail` from #6047; whichever lands second rebases trivially. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `unknown` status | Type-valid, but status machine has no transitions for it (`status-machine.ts:3-10`) → no-op. | Matches spec intent ("never guess captured"); assert in test. |
| Status poller never scheduled | `payment-gateways-status-poller` exists but nothing enqueues it. | Out of scope here; relevant to the reconciliation spec. |
| `target: 'top'` ignored by PayPage | None for full-page redirect. | Do not rely on `target`. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1 — Payer data.** Tpay `POST /transactions` requires `payer.email` and `payer.name`. `CreateSessionInput` has no payer field; checkout collects email/first/last name (`submit/route.ts:395-397`) but passes only `{ checkoutLinkId, checkoutSlug }` in `metadata`. Spec must choose:
  - (a) **Recommended:** checkout adds `customerEmail` and `customerName` to `metadata` (key `customerEmail` identical to PR #6047); adapter reads and validates them; missing → translated 422-style error, no provider call.
  - (b) Typed optional `payer` on `CreateSessionInput` (additive shared-contract change; needs BC note and touches all adapters' docs).
- **C2 — `pay` object.** OpenAPI marks `pay` required (with conditional sub-objects). Spec must state the hosted-redirect body (e.g. `pay` omitted vs `{ method: 'pay_by_link' }` without `groupId`/`channelId`) as proven by the PoC.
- **C3 — Status map.** `GET /transactions/{id}` status enum is `pending | paid | correct | refund | canceled`. Proposed map: `pending→pending`, `paid→captured`, `correct→captured`, `refund→refunded`, `canceled→cancelled`, anything else → `unknown`. `getStatus.amountReceived` from `payments.amountPaid` (when present) else `0`.
- **C4 — `verifyWebhook` and `mapStatus`.** Both are required `GatewayAdapter` members (`types.ts:19-42`). Spec must state: `verifyWebhook` throws an explicit `[internal]` unsupported error and **no** `registerWebhookHandler` is called in this phase; `mapStatus` implements C3.
- **C5 — Credential fields.** Define: `clientId` (text, required), `clientSecret` (secret, required), `environment` (select `sandbox|production`, default `sandbox`), `notificationUrl` (text, optional), `notificationSecurityCode` (secret, optional; consumed only by the notification spec). Note: the whole credentials blob is encrypted (`credentials-service.ts:167-174`); `secret` only affects UI masking. Env preset keys `OM_INTEGRATION_TPAY_CLIENT_ID`, `_CLIENT_SECRET`, `_ENVIRONMENT`, `_NOTIFICATION_URL`, `_NOTIFICATION_SECURITY_CODE`, `_ENABLED`, `_FORCE_PRECONFIGURE` (Stripe pattern).

### Important Gaps (Should Address)

- **I1 — Repo wiring checklist** (all observed as CI gates on #6047 or mirrored for Stripe):
  - `apps/mercato/package.json`, `apps/mercato/src/modules.ts`, `apps/mercato/.env.example` (commented `OM_INTEGRATION_TPAY_*` block);
  - `packages/create-app/template/package.json.template`, `template/src/modules.ts`, `template/.env.example`; `scripts/template-sync.ts` (`SYNC_INTERNAL_PACKAGE_KEYS`, and `TEMPLATE_COMMENTED_MODULES` if kept disabled);
  - if enabled in template: fact sheet must be required by a harness case (`packages/create-app/agentic/shared/ai/harness/cases.json`, `module-facts-build.test.ts:228`, `agent-surface-coverage.test.ts`);
  - `Dockerfile` (3 `COPY .../package.json` lines: deps, build, runner stages);
  - `scripts/package-peer-deps-allowlist.json` (or avoid the `@open-mercato/ui` dependency if unused, as #6047 review advised);
  - package `version` equal to `packages/shared/package.json` (0.9.0);
  - `.github/workflows/package-previews.yml` package list — **ask first** (pipeline automation per root `AGENTS.md`);
  - `packages/core/src/modules/auth/i18n/{en,pl,de,es,ko}.json` (`auth.acl.features.gateway_tpay.*`, `auth.acl.modules.gateway_tpay`);
  - docs: `apps/docs/docs/user-guide/tpay-payments.mdx` + `apps/docs/sidebars.ts`.
- **I2 — Callback URL validation details.** Sandbox port exception (80/8080/443) needs a trigger: tie it to `environment = sandbox`, not a separate flag.
- **I3 — HTTP bounds.** Specify concrete limits (e.g. 10 s timeout matching the health-service timeout, 256 KiB response cap) so tests can assert them.
- **I4 — Return URLs.** Map `successUrl` → `callbacks.payerUrls.success`, `cancelUrl` → `callbacks.payerUrls.error`; `lang` from payer locale when available, default `pl`.
- **I5 — `hiddenDescription` semantics.** `paymentId` is the checkout transaction id or a random UUID from the admin `/sessions` route — not a sales payment id. Correlation still holds via `GatewayTransaction.paymentId`; reword the spec table.

### Nice-to-Have Gaps

- Ambiguity recovery by `hiddenDescription` lookup (`GET /transactions` filter support unverified).
- Health check: `POST /oauth/auth` + `GET /oauth/tokeninfo` to report `degraded` on scope problems.
- Store `title` (Tpay human reference) in `gatewayMetadata` for support lookups.

## Remediation Plan

### Before Implementation (Must Do)

1. Resolve C1 (payer data path) — decision: metadata convention (recommended) vs typed field.
2. Confirm C2 request body from the PoC / sandbox.
3. Add C3 status table, C4 adapter-member behavior, C5 credential/env table to the spec.
4. Fix locale list to en/pl/de/es/ko.
5. Add CI-runnable integration tests (mocked Tpay HTTP) to Testing Strategy; keep live sandbox run as manual acceptance.

### During Implementation (Add to Spec)

1. Wiring checklist I1 as explicit Implementation Plan steps.
2. Concrete HTTP bounds (I3), return-URL/lang mapping (I4).
3. Error convention: `CrudHttpError(422)` + `gateway_tpay.errors.*` for unsupported ops / missing payer / non-PLN.
4. Changelog entry for the spec revision.

### Post-Implementation (Follow Up)

1. Live sandbox acceptance evidence recorded in the spec before enabling for any tenant.
2. Notification spec prerequisites: four generic `payment-gateway-webhook-*` specs (all `planned`).
3. Reconciliation spec: note that nothing currently enqueues `payment-gateways-status-poller`.

## Recommendation

**Needs spec updates first.** Five targeted edits (C1–C5) plus the locale fix and CI-runnable test plan; architecture and BC posture stay unchanged. After that the spec is a good fit for `om-auto-create-pr-loop` (single PR, ~6–8 steps).
