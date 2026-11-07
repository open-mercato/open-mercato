import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'checkout_link_templates' })
@Index({ properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class CheckoutLinkTemplate {
  [OptionalProps]?:
    | 'title'
    | 'subtitle'
    | 'description'
    | 'logoAttachmentId'
    | 'logoUrl'
    | 'primaryColor'
    | 'secondaryColor'
    | 'backgroundColor'
    | 'themeMode'
    | 'fixedPriceAmount'
    | 'fixedPriceCurrencyCode'
    | 'fixedPriceIncludesTax'
    | 'fixedPriceOriginalAmount'
    | 'customAmountMin'
    | 'customAmountMax'
    | 'customAmountCurrencyCode'
    | 'priceListItems'
    | 'gatewayProviderKey'
    | 'gatewaySettings'
    | 'flatRateShippingAmount'
    | 'flatRateShippingCurrencyCode'
    | 'customFieldsetCode'
    | 'collectCustomerDetails'
    | 'customerFieldsSchema'
    | 'legalDocuments'
    | 'displayCustomFieldsOnPage'
    | 'successTitle'
    | 'successMessage'
    | 'cancelTitle'
    | 'cancelMessage'
    | 'errorTitle'
    | 'errorMessage'
    | 'successEmailSubject'
    | 'successEmailBody'
    | 'sendSuccessEmail'
    | 'errorEmailSubject'
    | 'errorEmailBody'
    | 'sendErrorEmail'
    | 'startEmailSubject'
    | 'startEmailBody'
    | 'sendStartEmail'
    | 'passwordHash'
    | 'maxCompletions'
    | 'status'
    | 'checkoutType'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  title?: string | null

  @Property({ type: 'text', nullable: true })
  subtitle?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'logo_attachment_id', type: 'uuid', nullable: true })
  logoAttachmentId?: string | null

  @Property({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl?: string | null

  @Property({ name: 'primary_color', type: 'text', nullable: true })
  primaryColor?: string | null

  @Property({ name: 'secondary_color', type: 'text', nullable: true })
  secondaryColor?: string | null

  @Property({ name: 'background_color', type: 'text', nullable: true })
  backgroundColor?: string | null

  @Property({ name: 'theme_mode', type: 'text', default: 'auto' })
  themeMode: 'light' | 'dark' | 'auto' = 'auto'

  @Property({ name: 'pricing_mode', type: 'text' })
  pricingMode!: 'fixed' | 'custom_amount' | 'price_list'

  @Property({ name: 'fixed_price_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  fixedPriceAmount?: string | null

  @Property({ name: 'fixed_price_currency_code', type: 'text', nullable: true })
  fixedPriceCurrencyCode?: string | null

  @Property({ name: 'fixed_price_includes_tax', type: 'boolean', default: true })
  fixedPriceIncludesTax: boolean = true

  @Property({ name: 'fixed_price_original_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  fixedPriceOriginalAmount?: string | null

  @Property({ name: 'custom_amount_min', type: 'numeric', precision: 12, scale: 2, nullable: true })
  customAmountMin?: string | null

  @Property({ name: 'custom_amount_max', type: 'numeric', precision: 12, scale: 2, nullable: true })
  customAmountMax?: string | null

  @Property({ name: 'custom_amount_currency_code', type: 'text', nullable: true })
  customAmountCurrencyCode?: string | null

  @Property({ name: 'price_list_items', type: 'jsonb', nullable: true })
  priceListItems?: Array<{ id: string; description: string; amount: number; currencyCode: string }> | null

  @Property({ name: 'gateway_provider_key', type: 'text', nullable: true })
  gatewayProviderKey?: string | null

  @Property({ name: 'gateway_settings', type: 'jsonb', nullable: true })
  gatewaySettings?: Record<string, unknown> | null

  // Release 5, Step 2.13 (checkout C13/D-R5-35). The flat-rate carrier fallback for LINK
  // carts (B.2/B.3, §5.3) — the storefront-cart equivalent lives on
  // `ecommerce.EcommerceStore.settings.shipping.flatRate`. Inherited by `CheckoutLink`
  // the same way `gatewayProviderKey`/`gatewaySettings` already are.
  @Property({ name: 'flat_rate_shipping_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  flatRateShippingAmount?: string | null

  @Property({ name: 'flat_rate_shipping_currency_code', type: 'text', nullable: true })
  flatRateShippingCurrencyCode?: string | null

  @Property({ name: 'custom_fieldset_code', type: 'text', nullable: true })
  customFieldsetCode?: string | null

  @Property({ name: 'collect_customer_details', type: 'boolean', default: true })
  collectCustomerDetails: boolean = true

  @Property({ name: 'customer_fields_schema', type: 'jsonb', nullable: true })
  customerFieldsSchema?: Array<Record<string, unknown>> | null

  @Property({ name: 'legal_documents', type: 'jsonb', nullable: true })
  legalDocuments?: Record<string, unknown> | null

  @Property({ name: 'display_custom_fields_on_page', type: 'boolean', default: false })
  displayCustomFieldsOnPage: boolean = false

  @Property({ name: 'success_title', type: 'text', nullable: true })
  successTitle?: string | null

  @Property({ name: 'success_message', type: 'text', nullable: true })
  successMessage?: string | null

  @Property({ name: 'cancel_title', type: 'text', nullable: true })
  cancelTitle?: string | null

  @Property({ name: 'cancel_message', type: 'text', nullable: true })
  cancelMessage?: string | null

  @Property({ name: 'error_title', type: 'text', nullable: true })
  errorTitle?: string | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'success_email_subject', type: 'text', nullable: true })
  successEmailSubject?: string | null

  @Property({ name: 'success_email_body', type: 'text', nullable: true })
  successEmailBody?: string | null

  @Property({ name: 'send_success_email', type: 'boolean', default: true })
  sendSuccessEmail: boolean = true

  @Property({ name: 'error_email_subject', type: 'text', nullable: true })
  errorEmailSubject?: string | null

  @Property({ name: 'error_email_body', type: 'text', nullable: true })
  errorEmailBody?: string | null

  @Property({ name: 'send_error_email', type: 'boolean', default: true })
  sendErrorEmail: boolean = true

  @Property({ name: 'start_email_subject', type: 'text', nullable: true })
  startEmailSubject?: string | null

  @Property({ name: 'start_email_body', type: 'text', nullable: true })
  startEmailBody?: string | null

  @Property({ name: 'send_start_email', type: 'boolean', default: true })
  sendStartEmail: boolean = true

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'max_completions', type: 'integer', nullable: true })
  maxCompletions?: number | null

  @Property({ type: 'text', default: 'draft' })
  status: 'draft' | 'active' | 'inactive' = 'draft'

  @Property({ name: 'checkout_type', type: 'text', default: 'pay_link' })
  checkoutType: 'pay_link' | 'simple_checkout' = 'pay_link'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'checkout_links' })
@Index({ properties: ['organizationId', 'tenantId', 'status', 'deletedAt'] })
@Index({ properties: ['slug'], options: { unique: true, where: 'deleted_at is null' } })
export class CheckoutLink extends CheckoutLinkTemplate {
  @Property({ name: 'template_id', type: 'uuid', nullable: true })
  templateId?: string | null

  @Property({ type: 'text' })
  slug!: string

  @Property({ name: 'completion_count', type: 'integer', default: 0 })
  completionCount: number = 0

  @Property({ name: 'active_reservation_count', type: 'integer', default: 0 })
  activeReservationCount: number = 0

  @Property({ name: 'is_locked', type: 'boolean', default: false })
  isLocked: boolean = false
}

// Release 5, Step 3.5 (checkout §4.3, D-R5-19). Merchant-defined lines that seed a cart on
// first visit, for a `checkoutType: 'simple_checkout'` link ONLY — a Phase A
// `checkoutType: 'pay_link'` link never reads this table and keeps its existing,
// cart-less path end to end (C10, no regression).
//
// Scope cut (not in this Step's own Implementation list): no admin route writes these
// rows yet — a later Step adds the `CrudForm` sub-resource editor (§4.3's own "edited
// inside the link's CrudForm and saved with it, guarded by the parent's `updatedAt`").
// `product_id` is REQUIRED here (not the spec's nullable "catalog reference, or freeform
// for non-catalog items") because `cart.lines.add` has no freeform/non-catalog line path
// today; a freeform template line is a documented follow-up gap, not built in this Step.
@Entity({ tableName: 'checkout_link_cart_templates' })
@Index({ properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ properties: ['linkId', 'sortOrder'] })
export class CheckoutLinkCartTemplate {
  [OptionalProps]?:
    | 'variantId'
    | 'description'
    | 'sku'
    | 'quantity'
    | 'unitPriceOverride'
    | 'imageUrl'
    | 'isQuantityEditable'
    | 'sortOrder'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** `checkout.CheckoutLink.id` (FK-id, no ORM relation — this module's own table). */
  @Property({ name: 'link_id', type: 'uuid' })
  linkId!: string

  /** `catalog.CatalogProduct.id` (FK-id, cross-module — no ORM relation). */
  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'integer', default: 1 })
  quantity: number = 1

  /** Null -> resolve from catalog for the buyer (D-R5-19); set -> the merchant's fixed
   * price, applied verbatim regardless of buyer identity. */
  @Property({ name: 'unit_price_override', type: 'numeric', precision: 12, scale: 2, nullable: true })
  unitPriceOverride?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'image_url', type: 'text', nullable: true })
  imageUrl?: string | null

  @Property({ name: 'is_quantity_editable', type: 'boolean', default: false })
  isQuantityEditable: boolean = false

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'checkout_transactions' })
@Index({ properties: ['organizationId', 'tenantId', 'linkId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'createdAt'] })
@Index({ properties: ['gatewayTransactionId'] })
@Index({
  properties: ['organizationId', 'tenantId', 'linkId', 'idempotencyKey'],
  options: { unique: true },
})
// Release 5, Step 4.2 (§4.4): the session-backed gateway step's own idempotent lookup
// ("one `CheckoutTransaction` per session") — a session has no `linkId` to key by.
@Index({ properties: ['organizationId', 'tenantId', 'sessionId'] })
export class CheckoutTransaction {
  [OptionalProps]?:
    | 'linkId'
    | 'idempotencyKey'
    | 'customerData'
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'phone'
    | 'gatewayTransactionId'
    | 'paymentStatus'
    | 'selectedPriceItemId'
    | 'acceptedLegalConsents'
    | 'ipAddress'
    | 'userAgent'
    | 'sessionId'
    | 'orderId'
    | 'quoteId'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Release 5, Step 4.2 (§4.4, "extended, additive"). Nullable since this Step's own
  // session-backed gateway payments (§7.2 step 7) create a `CheckoutTransaction` with NO
  // link at all for a buyer-initiated session — Phase A's link-locking bookkeeping
  // (`checkout.transaction.create`/`.updateStatus`) stays link-only; the session path
  // writes this entity directly instead (see `commands/submit.ts`).
  @Property({ name: 'link_id', type: 'uuid', nullable: true })
  linkId?: string | null

  @Property({ type: 'text' })
  status!: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired'

  @Property({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'customer_data', type: 'jsonb', nullable: true })
  customerData?: Record<string, unknown> | null

  @Property({ name: 'first_name', type: 'text', nullable: true })
  firstName?: string | null

  @Property({ name: 'last_name', type: 'text', nullable: true })
  lastName?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'gateway_transaction_id', type: 'uuid', nullable: true })
  gatewayTransactionId?: string | null

  @Property({ name: 'payment_status', type: 'text', nullable: true })
  paymentStatus?: string | null

  @Property({ name: 'selected_price_item_id', type: 'text', nullable: true })
  selectedPriceItemId?: string | null

  @Property({ name: 'accepted_legal_consents', type: 'jsonb', nullable: true })
  acceptedLegalConsents?: Record<string, unknown> | null

  @Property({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress?: string | null

  @Property({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string | null

  // Release 5, Step 4.2 (§4.4). Set only by the session-backed gateway step (§7.2 step 7,
  // `commands/submit.ts`); null forever on every Phase A (link-only) row.
  @Property({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// Release 5, Step 2.12 (B.1, §4.1/§4.2 of the revised spec). `CheckoutSession` is the
// funnel's own aggregate — additive to Phase A, which keeps using `CheckoutLink` /
// `CheckoutTransaction` unchanged end to end (C10/D-R5-18: `checkout`'s `requires` stays
// exactly as it is today; see `index.ts`). `CheckoutSession` never holds cart lines — only
// the cart's own id (§4.1's own words).
@Entity({ tableName: 'checkout_sessions' })
@Index({ properties: ['tokenHash'], options: { unique: true } })
@Index({
  properties: ['tenantId', 'submitIdempotencyKey'],
  options: { unique: true, where: 'submit_idempotency_key is not null' },
})
@Index({ properties: ['tenantId', 'status', 'expiresAt'] })
@Index({ properties: ['tenantId', 'cartId', 'status'] })
export class CheckoutSession {
  [OptionalProps]?:
    | 'cartId'
    | 'storeId'
    | 'linkId'
    | 'status'
    | 'step'
    | 'email'
    | 'phone'
    | 'customerId'
    | 'customerUserId'
    | 'shippingAddress'
    | 'billingAddress'
    | 'billingSameAsShipping'
    | 'shippingMethod'
    | 'quotedTotals'
    | 'deliveryWindowId'
    | 'paymentMethodCode'
    | 'paymentIntentRef'
    | 'paymentExpiresAt'
    | 'purchaseOrderNumber'
    | 'creditReservationKey'
    | 'stockReservationKey'
    | 'submitIdempotencyKey'
    | 'submitAttempt'
    | 'submitProgress'
    | 'submitStartedAt'
    | 'outcomeKind'
    | 'salesOrderId'
    | 'salesQuoteId'
    | 'termsAcceptedAt'
    | 'consentFlags'
    | 'failureCode'
    | 'failureDetail'
    | 'completedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** SHA-256 hex of the opaque session token. The plaintext is returned once, by
   * `POST /api/checkout/sessions`, and never stored (C4, D-R4-18). */
  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  /** `cart.Cart.id` (FK-id, no ORM relation — root AGENTS.md). Nullable until a cart is
   * wired onto the session; every Step 2.12 creation path sets it immediately. */
  @Property({ name: 'cart_id', type: 'uuid', nullable: true })
  cartId?: string | null

  /** `ecommerce.EcommerceStore.id`; null for link and API carts (X13). */
  @Property({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string | null

  /** `checkout.CheckoutLink.id` for merchant-initiated sessions (B.2, not built yet). */
  @Property({ name: 'link_id', type: 'uuid', nullable: true })
  linkId?: string | null

  @Property({ type: 'text' })
  channel!: 'storefront' | 'pos' | 'pay_link' | 'agent' | 'api'

  @Property({ type: 'text', default: 'open' })
  status: CheckoutSessionStatus = 'open'

  @Property({ type: 'text', default: 'contact' })
  step: CheckoutSessionStep = 'contact'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ type: 'text' })
  locale!: string

  /** Encrypted at rest (`encryption.ts`). */
  @Property({ type: 'text', nullable: true })
  email?: string | null

  /** Encrypted at rest (`encryption.ts`). */
  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  /** A non-null value binds every `/current/*` route to that customer's session (§9.0). */
  @Property({ name: 'customer_user_id', type: 'uuid', nullable: true })
  customerUserId?: string | null

  /** Encrypted at rest (`encryption.ts`). */
  @Property({ name: 'shipping_address', type: 'jsonb', nullable: true })
  shippingAddress?: Record<string, unknown> | null

  /** Encrypted at rest (`encryption.ts`). */
  @Property({ name: 'billing_address', type: 'jsonb', nullable: true })
  billingAddress?: Record<string, unknown> | null

  @Property({ name: 'billing_same_as_shipping', type: 'boolean', default: false })
  billingSameAsShipping: boolean = false

  @Property({ name: 'shipping_method', type: 'jsonb', nullable: true })
  shippingMethod?: Record<string, unknown> | null

  @Property({ name: 'quoted_totals', type: 'jsonb', nullable: true })
  quotedTotals?: Record<string, unknown> | null

  @Property({ name: 'delivery_window_id', type: 'uuid', nullable: true })
  deliveryWindowId?: string | null

  @Property({ name: 'payment_method_code', type: 'text', nullable: true })
  paymentMethodCode?: string | null

  @Property({ name: 'payment_intent_ref', type: 'text', nullable: true })
  paymentIntentRef?: string | null

  @Property({ name: 'payment_expires_at', type: Date, nullable: true })
  paymentExpiresAt?: Date | null

  @Property({ name: 'purchase_order_number', type: 'text', nullable: true })
  purchaseOrderNumber?: string | null

  @Property({ name: 'credit_reservation_key', type: 'text', nullable: true })
  creditReservationKey?: string | null

  @Property({ name: 'stock_reservation_key', type: 'text', nullable: true })
  stockReservationKey?: string | null

  @Property({ name: 'submit_idempotency_key', type: 'text', nullable: true })
  submitIdempotencyKey?: string | null

  @Property({ name: 'submit_attempt', type: 'integer', default: 0 })
  submitAttempt: number = 0

  @Property({ name: 'submit_progress', type: 'text', nullable: true })
  submitProgress?: string | null

  @Property({ name: 'submit_started_at', type: Date, nullable: true })
  submitStartedAt?: Date | null

  @Property({ name: 'outcome_kind', type: 'text', nullable: true })
  outcomeKind?: 'order' | 'quote' | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'sales_quote_id', type: 'uuid', nullable: true })
  salesQuoteId?: string | null

  @Property({ name: 'terms_accepted_at', type: Date, nullable: true })
  termsAcceptedAt?: Date | null

  @Property({ name: 'consent_flags', type: 'jsonb', nullable: true })
  consentFlags?: Record<string, unknown> | null

  @Property({ name: 'failure_code', type: 'text', nullable: true })
  failureCode?: string | null

  /** Never holds PII (§4.1). */
  @Property({ name: 'failure_detail', type: 'text', nullable: true })
  failureDetail?: string | null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** §4.1 status enum, verbatim. */
export type CheckoutSessionStatus =
  | 'open'
  | 'awaiting_approval'
  | 'submitting'
  | 'awaiting_payment'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'

/** §5.2 step machine, verbatim. */
export type CheckoutSessionStep = 'contact' | 'addresses' | 'delivery' | 'payment' | 'review'

/**
 * Append-only audit of every step transition, external call and outcome (§4.2). No update,
 * no delete; exempt from optimistic locking (C20) — there is no `updated_at` to guard.
 * `payload` is redacted at write time (`lib/sessionEvents.ts`, C14): ids, codes, amounts and
 * statuses only, never card data, addresses, e-mail, phone or gateway secrets.
 */
@Entity({ tableName: 'checkout_session_events' })
@Index({ properties: ['tenantId', 'organizationId', 'sessionId', 'createdAt'] })
export class CheckoutSessionEvent {
  [OptionalProps]?: 'payload' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ type: 'text' })
  kind!: string

  @Property({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ type: 'text' })
  actor!: 'buyer' | 'system' | 'merchant' | 'agent'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export default [
  CheckoutLinkTemplate,
  CheckoutLink,
  CheckoutLinkCartTemplate,
  CheckoutTransaction,
  CheckoutSession,
  CheckoutSessionEvent,
]
