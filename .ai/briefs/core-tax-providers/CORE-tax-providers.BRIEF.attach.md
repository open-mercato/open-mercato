# Pluggable tax providers for sales documents: brief for `om-spec-writing`

Repository: systevio/open-mercato (fork of open-mercato/open-mercato), branch `develop`, evidence verified at
commit 78df61346. The fork differs from upstream `develop` only by the `.ai/briefs/` folder, so every code fact
below is upstream Open Mercato code and the change is meant as an upstream contribution.

Owner: Systevio. First consumer of the contract: an Avalara AvaTax provider package built after this spec, as an
official module (open-mercato/official-modules conventions, `@open-mercato/<package>` layout, UMES extension
points only). The provider package is out of scope here; this spec must make it possible without touching core.

## TLDR for the spec author

- Today the only tax seam is a unit amount service (`taxCalculationService`) that receives one amount and a table
  rate id. It does not receive the ship to address, the customer, the other lines or the product tax
  classification, so a real tax engine cannot be plugged in. Overriding the DI token from an app or a module is
  possible, but the override still sees one amount.
- Shipping and payment already follow a provider pattern in `sales/lib/providers/`: a registry, a provider shape
  with `key`, `label`, `settings` (fields plus zod schema) and `calculate(...)`, selection stored on the method
  row, and a totals calculator that runs the selected provider during `calculateDocumentTotals`. Tax needs the
  same shape, selected per organization, with a built in default that reproduces today's math.
- The contract must carry enough data for engines like Avalara: document type and date, currency, ship from,
  ship to and bill to addresses, customer identity and exemption facts, lines with quantity, amount, product code,
  tax code and per line address, plus a way to commit, adjust and void once a document is confirmed or invoiced.

## 1. Owner requirements (the goal; satisfy all of them)

- R1. Core must allow plugging in tax adapters other than the built in one. Today this is only possible by
  overriding the DI token from a standalone app or a module `di.ts` (verified: `packages/shared/src/lib/di/container.ts:291-299`
  for the app level `src/di.ts` override; module `di.ts` files register through the same container, last
  registration wins). That path stays supported, but the platform needs a first class provider slot.
- R2. A merchant must be able to choose a tax provider, with a default provider used when no other is chosen.
  The default reproduces today's behavior (table tax rates on lines) so existing tenants do not change.
- R3. A provider must receive more data than one amount. Depending on the provider it needs some or all of:
  the delivery (ship to) address, the billing address, the customer with its tax exemption facts, and the line
  items with their products and product tax information (tax rate id, tax classification or tax code), because
  some providers calculate per line item.
- R4. The data set is derived from what real tax APIs need. Avalara AvaTax is the reference (section 3), but the
  contract must not be Avalara specific: other providers and other countries calculate tax from the delivery
  address too.
- R5. The Avalara provider itself lives in a separate package (official module), configured by an admin with
  the credentials the provider needs (section 3.4). Core defines where such credentials and settings live and
  how a package declares them, following what shipping carriers and payment gateways already do.
- R6. The result of a provider calculation is persisted on the document (quote, order, invoice, credit memo)
  so that the amounts shown, the breakdown and the provenance survive, and so that a later commit or void can
  reference the provider transaction.
- R7. No shortcuts: full specification, full implementation with unit and integration tests, documentation
  updates, and a "Migration & Backward Compatibility" section.

## 2. Evidence in the repository (verified at 78df61346)

### 2.1 The unit seam that exists

- `packages/core/src/modules/sales/services/taxCalculationService.ts:24-26`: `TaxCalculationService.calculateUnitAmounts(input)`
  with `amount`, `mode` (`net`|`gross`), `organizationId`, `tenantId`, `taxRateId`, `taxRate`. Default implementation
  `DefaultTaxCalculationService` (`:28`) resolves the rate from `sales_tax_rates` (`:99-117`) and emits
  `sales.tax.calculate.before` and `sales.tax.calculate.after` (`:36-58`, catalog in `sales/events.ts:90-91`).
- Registered in `packages/core/src/modules/sales/di.ts:139` under `taxCalculationService`.
- Callers: `packages/core/src/modules/catalog/commands/prices.ts:350` and `:619` (price rows),
  `packages/core/src/modules/sales/commands/documents.ts:7176` and `:7675` (line unit price when one side is
  missing). None of them has an address, a customer or the other lines.
- Documentation already promises an external engine here: `apps/docs/docs/user-guide/taxes.mdx` ("Swapping DI
  services entirely", Avalara named) and `apps/docs/docs/framework/pricing-tax-overrides.mdx`.

### 2.2 The provider pattern that exists for shipping and payment

- `packages/core/src/modules/sales/lib/providers/registry.ts:11` `registerShippingProvider`, `:21`
  `registerPaymentProvider`, `:39` `getShippingProvider(key)`, `:44` `getPaymentProvider(key)`, `:49`
  `normalizeProviderSettings(kind, key, settings)`.
- `packages/core/src/modules/sales/lib/providers/types.ts:19` `ProviderSettingField` (`key`, `label`, `type`
  incl. `secret`, `select` with options), `:29` `ProviderSettingsDefinition` (`fields`, `schema`), `:97`
  `ShippingProvider` and `:107` `PaymentProvider` (`key`, `label`, `description`, `settings`, `calculate`).
- `packages/core/src/modules/sales/lib/providers/totals.ts:183-228`: a `registerSalesTotalsCalculator` hook reads
  `context.metadata.shippingMethod` / `paymentMethod`, resolves the provider by `providerKey`, normalizes settings,
  calls `provider.calculate({ method, settings, document, lines, context, metrics })` and merges adjustments,
  with events `sales.shipping.adjustments.apply.before/after` and `sales.payment.adjustments.apply.before/after`
  (`sales/events.ts:94-99`). Default providers with secret settings fields: `defaultProviders.ts:101-122` (Stripe).
- Docs: `apps/docs/docs/framework/modules/sales-providers.mdx` (provider settings are stored under
  `metadata.providerSettings` of the method row and exposed as `providerSettings` in CRUD APIs).

### 2.3 Document totals and where per line tax comes from

- `packages/core/src/modules/sales/lib/calculations.ts:120-186` line math: tax from `line.taxRate` unless the
  line carries an explicit `taxAmount`; `:221` sums `taxTotal`; `:485` `calculateDocumentTotals`; `:491`
  `registerSalesLineCalculator`; `:498` `registerSalesTotalsCalculator`.
- `packages/core/src/modules/sales/lib/types.ts:160-166` `SalesCalculationContext`: `tenantId`, `organizationId`,
  `currencyCode`, `metadata`, `resolve`. No addresses, no customer. `:42-75` `SalesLineSnapshot` has
  `productId`, `taxRate`, `taxAmount`; catalog snapshot on the line entity (`entities.ts:586`).
- Eleven recalculation call sites in `packages/core/src/modules/sales/commands/documents.ts`: `4932, 5351, 5617,
  6006, 7360, 7542, 7858, 8012, 8243, 8292, 8458`. Each has the document entity with
  `billing_address_snapshot`, `shipping_address_snapshot`, `customer_snapshot` (`data/entities.ts:358-370` orders,
  `:858-870` quotes).

### 2.4 Persistence that exists and what is missing

- `sales_orders`: `tax_strategy_key` (`entities.ts:397`), `tax_info` jsonb (`:403`), `tax_total_amount` (`:439`).
  `sales_quotes`: `tax_info` (`:888`), `tax_total_amount` (`:942`). Invoices (`:1383`) and credit memos
  (`:1550`) have only `tax_total_amount`. Lines carry `tax_rate` (`:640`, `:1077`, `:1527`, `:1679`).
- `tax_info` and `tax_strategy_key` travel through command snapshots and undo (`commands/documents.ts:247, 352,
  1701, 1990, 3952, 4013, 4100, 4415, 4780, 5844`); validators accept `taxStrategyKey` (`data/validators.ts:703`).
- Nothing records whether an amount is an estimate, a provider calculation or an exemption, when it was
  calculated, or the provider transaction reference.
- `SalesSettings` (`entities.ts:755-776`) is the per organization settings row (`order_number_format`,
  `quote_number_format`, editable statuses); settings routes follow `api/settings/order-editing/route.ts` with
  feature `sales.settings.manage` (`acl.ts:112`); `commands/settings.ts:9` `loadSalesSettings`.

### 2.5 Product and customer facts available today

- `packages/core/src/modules/catalog/data/entities.ts:106` `CatalogProduct.tax_rate_id`, `:109` `tax_rate`, `:177`
  `tax_classification_code`; variants `:618` `tax_rate_id`. `tax_classification_code` has 24 usages in
  `packages/core/src`.
- `packages/core/src/modules/customers/data/entities.ts:5` `CustomerEntityKind = 'person' | 'company'`. No tax
  exemption fields exist on customers (grep for `tax_exempt`, `exemption` in `customers/` returns nothing).
  The pending spec `.ai/specs/2026-08-10-address-contact-and-tax-fields.md` adds `taxId` and `taxIdType` to the
  address snapshot.

### 2.6 Credentials and integrations

- `packages/shared/src/modules/integrations/types.ts:173` `IntegrationDefinition` (`category`, `hub`,
  `providerKey`, `credentials.fields`, `healthCheck`); `:29` `IntegrationHubId` is an open string union with
  `payment_gateways`, `shipping_carriers`, ...; `:38` `CredentialFieldType` = `text | secret | select | boolean |
  url | oauth | ssh_keypair`. Credentials are stored encrypted by the integrations module and edited on the
  integration detail page. Reference external package: `open-mercato/official-modules`
  `packages/carrier-inpost/src/modules/carrier_inpost/integration.ts` (definition with secret fields) and `di.ts`
  (`registerShippingAdapter` from `shipping_carriers/lib/adapter-registry.ts`, a `globalThis` keyed registry).
- Docs: `apps/docs/docs/framework/modules/building-gateway-provider.mdx` (manifest, adapter, `di.ts`, health check).

### 2.7 Lifecycle events

- `sales/events.ts:31` `sales.order.confirmed`, `:32` `sales.order.cancelled`, `:41` `sales.invoice.created`,
  `:81` `sales.document.totals.calculated`, `:82-83` `sales.document.calculate.before/after`. Order confirmation
  is emitted from `commands/documents.ts:963-972`.

## 3. What a real tax engine needs (Avalara AvaTax REST v2, SDK `avatax` 26.9.0)

Source: `avadev/AvaTax-REST-V2-JS-SDK` `lib/AvaTaxClient.ts`, `lib/models/CreateTransactionModel.ts`,
`LineItemModel.ts`, `AddressesModel.ts`, `TransactionModel.ts`, `TransactionSummary.ts`, `lib/enums/DocumentType.ts`.
These are requirements on the data the core contract must carry, not an instruction to use this SDK in core.

### 3.1 Transaction (document) level input

`type` (`SalesOrder` = estimate, not recorded; `SalesInvoice` = recordable, can be committed), `companyCode`,
`date`, `currencyCode`, `customerCode`, `entityUseCode` (exemption reason), `exemptionNo` (certificate number),
`businessIdentificationNo` (VAT id), `purchaseOrderNo`, `referenceCode`, `discount`, `commit` (boolean),
`addresses` with `shipFrom`, `shipTo`, `billTo`, `singleLocation`, `pointOfOrderOrigin`,
`pointOfOrderAcceptance` (each: `line1..3`, `city`, `region`, `country`, `postalCode`, optional lat/long).

### 3.2 Line level input

`number` (line id), `quantity`, `amount` (extended line amount, not unit price), `itemCode` (SKU),
`taxCode` (provider tax code such as `PS081282`), `description`, `taxIncluded` (gross vs net), `discounted`,
`exemptionCode`, `entityUseCode`, per line `addresses`, `hsCode`, `parameters`.

### 3.3 Result

`totalTax`, `totalTaxable`, `totalExempt`, `totalTaxCalculated`, `status`, `code`, `id`, `lines[]` (per line tax,
taxable, exempt, details), `summary[]` (per jurisdiction: `jurisName`, `jurisType`, `jurisCode`, `taxName`,
`rate`, `taxable`, `tax`, `exemption`), `messages[]`. Lifecycle methods: `createTransaction`,
`createOrAdjustTransaction`, `commitTransaction`, `adjustTransaction`, `voidTransaction`, `refundTransaction`,
`verifyTransaction`; helpers `resolveAddress`, `listTaxCodes`, `listEntityUseCodes`, `ping`.

### 3.4 Credentials and client configuration an admin must provide

`withSecurity` accepts one of: `username` + `password`, `accountId` + `licenseKey`, or `bearerToken`
(Avalara Identity OAuth). Client construction needs `appName`, `appVersion`, `machineName`, `environment`
(`sandbox`, `production` or a custom base URL), optional `timeout`. Every transaction needs `companyCode`.
So the provider package will declare at least: environment (select), account id (text) and license key (secret)
or username/password, company code (text), optional default ship from address, and a flag whether orders are
committed on confirmation. Core must let a package declare exactly this kind of field set (see 2.6) and let the
provider read it at calculation time.

## 4. Questions the spec author must answer (bounded by the constraints given)

1. Contract placement and shape: extend `sales/lib/providers/` with `registerTaxProvider` / `getTaxProvider` /
   `listTaxProviders` and a `TaxProvider` type shaped like `ShippingProvider` (`key`, `label`, `description`,
   `settings`, `calculate`), or a separate registry as `shipping_carriers/lib/adapter-registry.ts`. Constraint:
   one pattern that an external package can call from `di.ts`; explain how it relates to the existing
   `taxCalculationService` token (unit amounts), which stays.
2. Selection per organization: a `tax_provider_key` (plus provider settings) on `SalesSettings` with a settings
   route and admin UI, or another existing surface. Constraint: default provider when unset; `sales.settings.manage`.
3. Calculate input: the exact type built from the document, lines, catalog product facts (tax rate id,
   tax classification code), addresses (ship to, bill to, ship from source), customer (id, kind, tax id from the
   address snapshot, exemption facts), currency, document date and kind. Constraint: it must cover 3.1 and 3.2
   without naming Avalara fields; unknown provider specific inputs travel in a `metadata` bag.
4. Calculate result: per line tax amount and rate, document tax total, breakdown per jurisdiction, status,
   provider transaction reference, calculated at. Constraint: 4 decimal rounding as `calculations.ts`; per line
   results feed `SalesLineSnapshot.taxAmount` before totals are summed.
5. Where the provider runs: one shared helper used by all eleven recalculation sites, or a line/totals calculator
   hook like `providers/totals.ts`. Constraint: exactly one call per recalculation, before the flush that persists
   totals, with a timeout; the default provider runs the same path.
6. Customer exemption facts: which fields core adds to customers (for example `is_tax_exempt`, exemption
   certificate number encrypted like other PII, entity use code), in which phase, and how they reach
   `customer_snapshot`.
7. Persistence: reuse `tax_info` (with a zod schema) and `tax_strategy_key` for the provider key; add what is
   missing on invoices and credit memos; add status and calculated at columns; extend command snapshots, undo
   payloads, validators and API responses. Constraint: additive columns only, no backfill, `tax_total_amount`
   stays the displayed amount.
8. Failure behavior: provider error or timeout on a quote or order versus on an invoice; never a silent zero;
   what the status says and what the admin sees. Constraint: the default provider is the fallback for amounts.
9. Lifecycle: which existing events (order confirmed, cancelled, invoice created, credit memo created) carry
   what payload so a package can commit, adjust and void, and whether the contract gets optional `commit`,
   `void`, `adjust` methods now or later.
10. Credentials: whether a tax provider package declares an `IntegrationDefinition` with `hub: 'tax_providers'`
    (new hub id) for credentials and a health check, and provider `settings` for non secret options. Constraint:
    secrets only through the integrations module encryption.
11. Undo of a document command after a provider call: replay the stored result or recalculate.
12. Rounding reconciliation when per line tax does not sum to the provider's document total.

## 5. Related pending specs (extend, do not duplicate)

- `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`: `phone`, `taxId`, `taxIdType` on `AddressValue` and
  the document address snapshot. The bill to address carries the customer tax id to the provider.

## 6. Acceptance (integration coverage the spec must include)

1. Clean instance, no provider configured: create a quote with two product lines carrying table rates plus
   shipping, convert to order, create invoice. Every amount equals the pre spec value; the stored provenance says
   the default provider; the breakdown has one entry per line.
2. A test provider registered from a test module, selected for organization A, returning fixed per line amounts
   and a two jurisdiction breakdown: totals use those amounts; the invoice created from the order carries the same
   breakdown; the order confirmed event payload carries the provider key and transaction reference.
3. The test provider throws or times out: amounts fall back to the default provider; status marks the estimate;
   the API caller gets no error; the failure is visible to an admin.
4. Organization B on the same instance has no provider selected: behaves as case 1 while A behaves as case 2.
5. Provider settings and credentials: a package declaring secret fields sees them decrypted at calculation time
   and never in API responses or logs.
