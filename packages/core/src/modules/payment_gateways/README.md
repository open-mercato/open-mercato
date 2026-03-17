# Payment Gateways Extension Contract

The `payment_gateways` module exposes a small set of stable UMES-facing contracts for payment transaction flows.

## Payment Transaction Create Form

The create dialog now uses `CrudForm` in embedded mode.

- Generic form spot: `crud-form:payment_gateways.transaction-create`
- Generic form field spot: `crud-form:payment_gateways.transaction-create:fields`
- Generic form header spot: `crud-form:payment_gateways.transaction-create:header`

Use the generic form spot when you need cross-provider behavior such as:

- `onBeforeSave` / `onAfterSave`
- validation transforms
- global mutation request headers
- additive form fields that are not provider-specific

The implementation lives in [`components/CreatePaymentTransactionDialog.tsx`](/Users/piotrkarwatka/Projects/mercato-development-two/packages/core/src/modules/payment_gateways/components/CreatePaymentTransactionDialog.tsx).

## Provider-Specific Create Fields

Gateway integrations can inject provider-specific create fields by setting `paymentGateway.transactionCreateFieldSpotId` in their `integration.ts`.

Use the shared helper from `@open-mercato/shared/modules/payment_gateways/types`:

```ts
buildPaymentGatewayTransactionCreateFieldSpotId(providerKey)
```

Current spot shape:

```text
payment-gateways.transaction-create:<providerKey>:fields
```

These widgets are rendered inside the CrudForm-backed dialog after the base transaction fields.

## Payment Link Widget Spot

Payment-link public checkout widgets should use:

```ts
buildPaymentGatewayPaymentLinkWidgetSpotId(providerKey)
```

Current spot shape:

```text
payment-gateways.payment-link:<providerKey>
```

## Payment Link Page Host

The public `/pay/[token]` page now lives in the separate `payment_link_pages` module so apps can eject or replace it without disabling `payment_gateways`.

Stable customization surfaces:

- Page replacement handle: `page:/pay/[token]`
- Section replacement handles:
  - `section:payment_link_pages.brand`
  - `section:payment_link_pages.summary`
  - `section:payment_link_pages.checkout`
- Injection spots:
  - `payment-link-pages.pay:before`
  - `payment-link-pages.pay:hero`
  - `payment-link-pages.pay:summary`
  - `payment-link-pages.pay:checkout`
  - `payment-link-pages.pay:after`

The page consumes `GET /api/payment_link_pages/pay/[token]`, which is enricher-aware and returns additive metadata fields:

- `link.metadata`
- `link.customFields`
- `link.customFieldsetCode`

The transaction create dialog supports pay-link page metadata and custom-field-driven fieldsets via:

- `paymentLink.metadata`
- `paymentLink.customFieldsetCode`
- `paymentLink.customFields`

## DataTable Extension Surface

The transactions hub uses the stable table id:

```ts
PAYMENT_GATEWAY_TRANSACTIONS_TABLE_ID
```

Current value:

```text
payment_gateways.transactions.list
```

This enables the standard DataTable extension spots:

- `data-table:payment_gateways.transactions.list:columns`
- `data-table:payment_gateways.transactions.list:row-actions`
- `data-table:payment_gateways.transactions.list:bulk-actions`
- `data-table:payment_gateways.transactions.list:filters`

## Emitted Events

Transaction flows now emit transaction-centric events in addition to the older gateway lifecycle events.

- `payment_gateways.transaction.created`
- `payment_gateways.transaction.updated`
- `payment_gateways.transaction.status_changed`
- `payment_gateways.payment_link.created`
- `payment_gateways.session.created`
- `payment_gateways.payment.authorized`
- `payment_gateways.payment.captured`
- `payment_gateways.payment.failed`
- `payment_gateways.payment.refunded`
- `payment_gateways.payment.cancelled`
- `payment_gateways.webhook.received`
- `payment_gateways.webhook.failed`

### Event Intent

- Use `payment_gateways.transaction.created` for “a new transaction exists”.
- Use `payment_gateways.transaction.updated` for metadata/payment-link/webhook-driven updates that may not change status.
- Use `payment_gateways.transaction.status_changed` when a subscriber cares specifically about status transitions.
- Use `payment_gateways.payment_link.created` for link distribution, notification, or provider-specific side effects.

### Status Change Payload

`payment_gateways.transaction.status_changed` includes:

- `transactionId`
- `paymentId`
- `providerKey`
- `previousStatus`
- `status`
- `nextStatus`
- `trigger`
- `organizationId`
- `tenantId`

`trigger` is one of:

- `create`
- `capture`
- `refund`
- `cancel`
- `poll`
- `webhook`

## Server-Side Mutation Hooks

`POST /api/payment_gateways/sessions` now participates in:

- API interceptors for route `payment_gateways/sessions`
- legacy mutation guards via `validateCrudMutationGuard(...)`
- post-success mutation guard callbacks via `runCrudMutationGuardAfterSuccess(...)`

This keeps the create transaction flow aligned with other UMES-aware custom write routes.
