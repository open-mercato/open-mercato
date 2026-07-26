# Tpay — Full Production Integration for Open Mercato

- **Status:** planned
- **Date:** 2026-07-26
- **Type:** OSS integration provider (upstreamable), extends the PoC
- **Predecessor:** an internal Tpay B2B storefront proof of concept (implemented; not part of this PR)
- **Reference contract:** `packages/gateway-stripe` + `.ai/skills/om-integration-builder/SKILL.md`
- **Adapter contract:** `packages/shared/src/modules/payment_gateways/types.ts` (`GatewayAdapter`)

## 1. Purpose

Take the PoC `gateway-tpay` package from a redirect-only proof of concept to a **production-grade, upstreamable** Tpay payment provider for Open Mercato — the platform's first fully-featured Polish payment gateway (BLIK, cards + 3DS, Polish bank transfers, wallets), with authoritative webhook confirmation, refunds, PLN-first currency handling (optional EUR), observability, and a full test suite.

The package stays **generic and client-agnostic** (no downstream customer identity anywhere) so it can be contributed to the `open-mercato` OSS repo.

### Guiding principle: parity with `gateway-stripe`

Open Mercato already ships a **production payment gateway, `gateway-stripe`**. It is the canonical reference and the single biggest de-risker for this work: **every component of the full Tpay integration should mirror how `gateway-stripe` already solves the same problem** — same `GatewayAdapter` contract, same package/file layout, same DI registration, same marketplace wiring. Divergence is allowed only where Tpay genuinely differs (redirect vs. embedded, md5+JWS vs. Stripe-SDK signatures, Polish methods), and every divergence is called out explicitly. If Stripe does it a certain way, that is the default answer for Tpay.

**Parity map — what `gateway-stripe` already has and Tpay should match:**

| `gateway-stripe` component | Tpay equivalent to build | Phase |
|---|---|---|
| Versioned adapters `lib/adapters/v<version>.ts` (+ default alias) | Version Tpay adapter(s) under `lib/adapters/`; keep `v1`, add versions as the OpenAPI evolves | 2/5 |
| `lib/webhook-handler.ts` (SDK signature verify) + `readSessionIdHint` | md5 **+ JWS** verification (`lib/checksum.ts`, `lib/jws.ts`, `lib/webhook-handler.ts`) | 1 |
| `workers/webhook-processor.ts` (async queue worker) | `workers/webhook-processor.ts` for `QUEUE_STRATEGY=async` | 1 |
| `widgets/injection/stripe-config/` (+ `injection-table.ts`) admin config widget | `widgets/injection/tpay-config/` admin config widget | 2 |
| Embedded client renderer `widgets/payments/client.tsx` | Redirect renderer(s); embedded only if a method needs it (e.g. card fields) | 2 |
| `lib/status-map.ts`, `lib/health.ts`, `lib/preset.ts`, `setup.ts`, `acl.ts`, `cli.ts`, i18n, `__tests__/*` | Already present (PoC); extend to match Stripe's depth | all |
| Descriptor with `renderers[]` + `sessionConfig` | Extend descriptor with per-method renderers | 2 |

Where the PoC intentionally skipped a Stripe-parity file (async worker, config widget, versioned-adapter discipline), closing that gap **is** part of this spec.

## 2. Current state (PoC — already implemented)

`packages/gateway-tpay` (`@open-mercato/gateway-tpay`, module `gateway_tpay`), mirroring `gateway-stripe`:

- **Adapter** (`lib/adapters/v1.ts`) implementing `GatewayAdapter`: `createSession` (OAuth token → `POST /transactions` → returns `transactionPaymentUrl` as `redirectUrl` + `{type:'redirect'}` client session), `getStatus` (`GET /transactions/{id}`), `capture`/`refund`/`cancel` (minimal), `verifyWebhook` (md5), `mapStatus`.
- **Client** (`lib/tpay-client.ts`): `fetch`-based OAuth (cached), create/get/refund transaction; sandbox/prod base URLs. No PHP, no SDK.
- **Webhook** (`lib/webhook-handler.ts` + `lib/checksum.ts`): form-urlencoded parse + **md5 checksum** verification (timing-safe).
- **Wiring**: `integration.ts` (credential fields, `webhook_setup` help), `di.ts` (adapter + webhook handler + redirect descriptor + health), `health.ts` (live OAuth), `preset.ts` (`OM_INTEGRATION_TPAY_*`), `cli.ts` (`configure-from-env`), `setup.ts`, `acl.ts`, i18n, unit tests (25).
- **Storefront demo** (`apps/mercato/src/modules/storefront`): portal catalog/cart/checkout/orders pages, `POST /api/storefront/checkout` (creates `SalesOrder` + checkout pay-link → `/pay/[slug]`), `order-payment-settled` subscriber, demo PLN product seed.

**Live-verified end-to-end** against the Tpay sandbox: catalog → cart → checkout → real `SalesOrder` → Tpay hosted page → BLIK → return page shows **"Payment completed"** (settlement via the `/pay/[slug]` `getPaymentStatus` poll → `payment_gateways.payment.captured` → settlement subscriber → order marked paid).

## 3. Known issues surfaced by PoC testing (address as part of this work)

1. **Settlement relies on the return-page poll**, not an authoritative server-to-server webhook. The core webhook route (`payment_gateways/api/webhook/[provider]/route.ts`) parses the body as JSON and locates the transaction via `readSessionIdHint(json)`; Tpay posts **form-urlencoded**, so that path cannot locate the transaction. → Ship a provider-owned notify route (Phase 1).
2. **md5-only verification.** JWS signature (`x-jws-signature`) is not yet verified. → Phase 1.
3. **Notification URL** must be publicly reachable and ack the literal `TRUE`; in the PoC it pointed at a placeholder. → Phase 1 + docs.
4. **Channel-scoped pricing:** the storefront pricing context passes `channelId: null`, so channel-scoped catalog prices don't resolve (PoC seeded channel-less PLN prices to work around it). → Phase 6.
5. **Portal login on custom domains:** `resolveTenantContext` treats non-`PLATFORM_DOMAINS` hosts as custom domains requiring a domain→org mapping (so a tunnel host 404s). Not a gateway concern; documented for demo/deploy. → Phase 7 docs.
6. **Fixed during PoC testing:** catalog price query `populate('variant')` crashed on schema-drift (`gtin_type`); removed the populate.

## 4. Phases

### Phase 1 — Authoritative webhook confirmation & signature hardening
**Goal:** payments settle from a verified server-to-server notification, not only the return-page poll.

- **Provider-owned notify route** `api/webhook/route.ts` (or `api/notify/route.ts`) in `gateway_tpay`, path `/api/gateway_tpay/notify`, `requireAuth:false`:
  - Read raw body (form-urlencoded), parse fields (`id`, `tr_id`, `tr_crc`, `tr_amount`, `tr_status`, `md5sum`, JWS header).
  - Locate candidate `GatewayTransaction`(s) **without trusting payload scope** — by `providerSessionId`/stashed `hiddenDescription` correlation, then derive tenant scope only from a candidate whose per-tenant credentials verify the signature (mirror the core webhook route's fail-closed pattern).
  - Verify **both** md5 checksum and JWS (see below); reply literal `TRUE` on success, `FALSE - <reason>` + 400 on failure.
  - Drive `paymentGatewayService.syncTransactionStatus(txId, { unifiedStatus, providerStatus, providerData, webhookEvent }, scope)` → emits `payment_gateways.payment.*`.
  - Idempotency via `WebhookProcessedEvent` (`idempotencyKey = tpay:<tr_id>:<tr_status>`); support `QUEUE_STRATEGY=async`.
- **JWS verification** (`lib/jws.ts`): parse the detached `x-jws-signature` (`header..signature`); base64url-decode the protected header; read `x5u`; fetch the leaf cert (cached); validate the chain to a **pinned Tpay root** (`https://secure.tpay.com/x509/tpay-jws-root.pem` prod, `secure.sandbox.tpay.com/...` sandbox); verify RSA-SHA256 over `header.base64url(body)`. Root-cert pinning + refresh strategy + `x5u` host allow-list (`secure.tpay.com` / `secure.sandbox.tpay.com`).
- **Correlation:** send Tpay `hiddenDescription` = `paymentId` on `createSession` so the notification's `tr_crc` maps back to the `GatewayTransaction` deterministically; also store `title` in `gatewayMetadata`.
- **Set the notification URL** from per-tenant credential (`notificationUrl`) → env (`OM_INTEGRATION_TPAY_NOTIFICATION_URL`) → request origin fallback; document that it must be public (tunnel in dev, real host in prod).
- **Tests:** valid md5+JWS accepted; tampered md5 rejected; bad/expired cert rejected; wrong-scope candidate rejected; idempotent replay is a no-op; `TRUE` body asserted.

### Phase 2 — Payment methods & renderers
- **Pay-by-link channel selection:** `GET /transactions/channels`; expose channels; add `pay.channelId` to the create payload; descriptor renderer for "choose bank".
- **BLIK:** hosted redirect (done), plus direct BLIK code (`POST /transactions/{id}/pay`) and BLIK level-0/alias register+charge (separate `notification`/alias webhook events).
- **Cards + 3DS:** card payment via `transactionPaymentUrl` = 3DS URL; card tokenization capture from the notification (`card_token`, `card_brand`, `card_tail`).
- **Wallets:** Apple Pay (`/wallet/applepay/init`), Google Pay, Visa Mobile.
- **Descriptor:** per-method renderers in `registerPaymentGatewayDescriptor` (`type:'redirect'` for hosted, embedded where applicable), `supportedPaymentTypes`.

### Phase 3 — Refunds, cancellations, captures
- **Refunds:** `POST /transactions/{id}/refunds` full + partial; map refund status; wire the existing `payment_gateways` manual-action routes (`api/refund`) + admin UI.
- **Cancel/expire:** handle unpaid-transaction expiry; reflect `cancelled`/`expired` unified statuses.
- **Capture:** redirect auto-captures; keep `capture` a status-reflecting no-op (documented).

### Phase 4 — Currency support (PLN primary; EUR as a scoped follow-up)
Tpay supports **PLN and EUR only** — not arbitrary currencies — so this is **not** generic multi-currency. PLN is the provider's primary, default currency.
- Descriptor keeps `supportedCurrencies: ['PLN']`; reject any non-PLN currency at session create with a clear error until EUR is explicitly enabled for a tenant.
- **EUR is a separate, more complex case, deliberately out of the initial scope.** Tpay settles EUR through a **dedicated EUR POS** on the merchant account (its own POS/credentials), with currency-scoped notifications and per-currency handling. Treat it as opt-in: add a second POS credential and widen `supportedCurrencies` to `['PLN', 'EUR']` only when a tenant needs it, and validate the order currency against the configured POS.
- Do **not** build open-ended multi-currency; Tpay does not support it.

### Phase 5 — Status state machine & reconciliation
- Complete provider→unified mapping (`pending/correct/paid/refund/refunded/chargeback/declined/error/canceled`), notification `tr_status` tokens (`TRUE`/`CHARGEBACK`/`FALSE`), and expiry.
- Periodic reconciliation job (`getStatus` for stale `pending` transactions) to self-heal missed notifications.

### Phase 6 — Storefront productionization (separate, related)
> The `storefront` slice is a demo veneer; harden or replace it for a real deployment. Track separately from the gateway package.
- Persisted cart entity (replace client-only cart); buyer identity from portal session (email prefill on `/pay`).
- Pricing: pass the buyer's sales channel + customer group into the pricing context (fixes the channel-scoped-price gap); B2B net prices, price lists.
- Settlement subscriber robustness (already binds order by `customerReference`); order status transitions; confirmation email/notification.
- **Stage 2** (future roadmap): credit limits, employee permissions per company, promotions, PDF offers, e-invoice.

### Phase 7 — Observability, testing, docs, upstreaming
- **Observability:** integration logs on every op, `webhookLog`, deeper health check (POS/currency), optional metrics.
- **Testing:** unit (done); integration tests against the Sylius plugin's Mockoon fixture (`tests/mockoon_tpay.json`) shapes; Playwright E2E (catalog→pay→settled); a sandbox contract test.
- **Docs:** provider `README.md` (setup, env, methods), admin **Tpay merchant-panel** configuration guide (client_id/secret, notification security code, notification URL), `apps/docs` page.
- **Upstreaming:** contribute `gateway-tpay` to `open-mercato` OSS; follow `BACKWARD_COMPATIBILITY.md`; add a changeset; ensure zero client-domain naming (grep before PR).

## 5. Integration coverage (must ship with the feature)

| Surface | Path | Test |
|---|---|---|
| Notify webhook | `POST /api/gateway_tpay/notify` | md5+JWS accept/reject, idempotency, `TRUE` reply |
| Session create | adapter `createSession` → `POST /transactions` | payload shape, redirect URL, correlation |
| Status poll | `GET /api/checkout/pay/[slug]/status/[tx]` → `getStatus` | pending→captured transition emits event |
| Refund | `POST /api/payment_gateways/refund` | full/partial, status map |
| Channels | `GET /transactions/channels` | channel list + `pay.channelId` |
| Health | Integrations UI health check | healthy/unhealthy |
| Storefront | `/{orgSlug}/portal/{catalog,cart,checkout,orders}`, `POST /api/storefront/checkout` | order bound to buyer, settles to Paid |

## 6. Architecture decisions

- **Provider-owned notify route** (not the core JSON webhook route) because Tpay posts form-urlencoded and finalizes independently of ack; the route still funnels through `paymentGatewayService.syncTransactionStatus` so all downstream events/subscribers are unchanged.
- **Verify md5 AND JWS**; md5 is the baseline, JWS is the cryptographic proof. Fail closed.
- **Never trust payload scope** — derive tenant/org only from a `GatewayTransaction` whose per-tenant credentials verify the signature.
- **Keep the package generic/upstreamable**; the storefront demo (client-flavoured) stays in the app module.

## 7. Risks

- **Tpay root-cert rotation** — pin + refresh strategy; alert on chain-validation failures.
- **Notification reachability in dev** — requires a public tunnel; document `PLATFORM_DOMAINS` + notification URL.
- **Method breadth** — cards/3DS/wallets each have edge cases; phase them, gate by descriptor.
- **Currency/POS** — Tpay supports only PLN and EUR, and EUR needs its own POS. Default to PLN, validate the order currency against the configured POS, and gate EUR behind an explicit per-tenant EUR POS.

## 8. Backward compatibility & upstreaming

- New package + new API route + new descriptor renderers are **additive**. No changes to `payment_gateways` core contracts.
- Follow the deprecation protocol only if any shared contract must change (none expected).
- Add a changeset; land as a normal OSS PR with integration tests; verify no client-domain naming.
