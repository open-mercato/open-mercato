import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

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

@Entity({ tableName: 'checkout_transactions' })
@Index({ properties: ['organizationId', 'tenantId', 'linkId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'createdAt'] })
@Index({ properties: ['gatewayTransactionId'] })
@Index({
  properties: ['organizationId', 'tenantId', 'linkId', 'idempotencyKey'],
  options: { unique: true },
})
export class CheckoutTransaction {
  [OptionalProps]?:
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
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'link_id', type: 'uuid' })
  linkId!: string

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

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export default [CheckoutLinkTemplate, CheckoutLink, CheckoutTransaction]
