# `@open-mercato/checkout`

`@open-mercato/checkout` provides the `checkout` module for standalone pay links and the Phase A public payment flow.

## What the package contains

- Link templates for reusable payment-page defaults
- Pay links with fixed, custom-amount, and price-list pricing modes
- Public `/pay/[slug]` pages with password protection, usage limits, and legal-consent capture
- Checkout transactions correlated to `payment_gateways` sessions through `paymentId = checkoutTransaction.id`
- Checkout-owned UMES extension points for pay-page composition and gateway-transaction linking

## Install and enable

1. Add the workspace package to the app: `yarn workspace apps/mercato add @open-mercato/checkout@workspace:*`
2. Enable the module in [`apps/mercato/src/modules.ts`](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/src/modules.ts):

```ts
{ id: 'checkout', from: '@open-mercato/checkout' }
```

3. Run `npm run modules:prepare` if you changed auto-discovered module files.
4. Run database migrations before using the module in a real environment.

## Scripts

- `yarn workspace @open-mercato/checkout build`
- `yarn workspace @open-mercato/checkout watch`
- `yarn workspace @open-mercato/checkout test`
- `yarn workspace @open-mercato/checkout typecheck`

## Admin flow

- Create a template when you want reusable branding, pricing, customer-field, and email defaults.
- Create a pay link directly or start from a template.
- Publish the link when the page is ready to accept payments.
- Track attempts in Transactions, where customer PII is gated behind `checkout.viewPii`.

## Public flow

- `GET /api/checkout/pay/:slug` returns the public link payload or a password gate.
- `POST /api/checkout/pay/:slug/verify-password` creates the slug-bound password session.
- `POST /api/checkout/pay/:slug/submit` validates server-authoritative pricing, legal consents, and idempotency before creating the gateway session.
- `GET /api/checkout/pay/:slug/status/:transactionId` polls the linked checkout transaction without exposing cross-link data.

Password-protected links need a signing secret. Configure `AUTH_SECRET` or `NEXTAUTH_SECRET` in the app env when possible. If they are unset, checkout falls back to `JWT_SECRET`, then `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`.

## Extensibility

Checkout exposes stable UMES surfaces for customization:

- Injection spots:
  - `data-table:payment_gateways.transactions.list:toolbar`
  - `admin.page:payment-gateways/transactions:after`
- Replacement handles:
  - `page:checkout.pay-page`
  - `page:checkout.success-page`
  - `page:checkout.error-page`
  - `section:checkout.pay-page.header`
  - `section:checkout.pay-page.description`
  - `section:checkout.pay-page.summary`
  - `section:checkout.pay-page.pricing`
  - `section:checkout.pay-page.payment`
  - `section:checkout.pay-page.customer-form`
  - `section:checkout.pay-page.legal-consent`
  - `section:checkout.pay-page.gateway-form`
  - `section:checkout.pay-page.help`
  - `section:checkout.pay-page.footer`
  - `section:checkout.success-page.content`
  - `section:checkout.error-page.content`
  - `crud-form:checkout:link`
  - `crud-form:checkout:template`
  - `data-table:checkout-links`
  - `data-table:checkout-templates`
  - `data-table:checkout-transactions`

Customization must not bypass payment-critical server checks. Amount calculation, password verification, legal-consent enforcement, transaction status reconciliation, and usage-limit accounting remain server-authoritative.

## Gateway-provider contract

Checkout depends on the additive descriptor surface in `payment_gateways`:

- `paymentGatewayDescriptorService.list(scope)`
- `paymentGatewayDescriptorService.get(providerKey, scope)`
- `GET /api/payment_gateways/providers`
- `GET /api/payment_gateways/providers/:providerKey`

Descriptors must provide safe session metadata only:

- `sessionConfig.fields`
- `sessionConfig.supportedCurrencies`
- `sessionConfig.supportedPaymentTypes`
- `sessionConfig.presentation`

Checkout uses these descriptors for admin settings forms, supported-currency validation, and public payment presentation choices. Raw credentials and provider-internal configuration never leave the gateway package.

## Canary publishing expectations

This package is intended to be published independently from core. Before cutting a canary:

1. Run package tests and the relevant monorepo build.
2. Confirm the generated dist output matches the current source exports.
3. Keep pay-page handles, injection spot ids, route paths, and event ids backward-compatible.
