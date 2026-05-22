import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'subscription_plans' })
@Index({ properties: ['organizationId', 'tenantId', 'productCode'] })
@Unique({ properties: ['tenantId', 'organizationId', 'code'] })
export class SubscriptionPlan {
  [OptionalProps]?:
    | 'description'
    | 'entitlementsJson'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'code', type: 'text' })
  code!: string

  @Property({ name: 'product_code', type: 'text' })
  productCode!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'entitlements_json', type: 'jsonb', nullable: true })
  entitlementsJson?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean' })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'subscription_prices' })
@Index({ properties: ['organizationId', 'tenantId', 'plan'] })
@Unique({ properties: ['tenantId', 'organizationId', 'code'] })
export class SubscriptionPrice {
  [OptionalProps]?:
    | 'trialDays'
    | 'providerProductRef'
    | 'providerPriceRef'
    | 'isDefault'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => SubscriptionPlan, { fieldName: 'plan_id' })
  plan!: SubscriptionPlan

  @Property({ name: 'code', type: 'text' })
  code!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'interval', type: 'text' })
  interval!: 'month' | 'year'

  @Property({ name: 'interval_count', type: 'int' })
  intervalCount!: number

  @Property({ name: 'unit_amount_minor', type: 'int' })
  unitAmountMinor!: number

  @Property({ name: 'trial_days', type: 'int', nullable: true })
  trialDays?: number | null

  @Property({ name: 'provider_product_ref', type: 'text', nullable: true })
  providerProductRef?: string | null

  @Property({ name: 'provider_price_ref', type: 'text', nullable: true })
  providerPriceRef?: string | null

  @Property({ name: 'product_lookup_key', type: 'text' })
  productLookupKey!: string

  @Property({ name: 'price_lookup_key', type: 'text' })
  priceLookupKey!: string

  @Property({ name: 'is_default', type: 'boolean' })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean' })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'subscriptions' })
@Index({ properties: ['organizationId', 'tenantId', 'externalAccountId'] })
@Index({ properties: ['organizationId', 'tenantId', 'accessState'] })
@Index({ properties: ['providerKey', 'providerSubscriptionId'] })
export class Subscription {
  [OptionalProps]?:
    | 'providerSubscriptionId'
    | 'currentPeriodStart'
    | 'currentPeriodEnd'
    | 'trialEndsAt'
    | 'cancelAtPeriodEnd'
    | 'cancelledAt'
    | 'lastProviderEventAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'external_account_id', type: 'text' })
  externalAccountId!: string

  @Property({ name: 'subject_entity_type', type: 'text' })
  subjectEntityType!: string

  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  @ManyToOne(() => SubscriptionPlan, { fieldName: 'plan_id' })
  plan!: SubscriptionPlan

  @ManyToOne(() => SubscriptionPrice, { fieldName: 'price_id' })
  price!: SubscriptionPrice

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'provider_customer_id', type: 'text' })
  providerCustomerId!: string

  @Property({ name: 'provider_subscription_id', type: 'text', nullable: true })
  providerSubscriptionId?: string | null

  @Property({ name: 'provider_status', type: 'text' })
  providerStatus!: string

  @Property({ name: 'access_state', type: 'text' })
  accessState!: 'pending' | 'granted' | 'grace' | 'blocked'

  @Property({ name: 'current_period_start', type: Date, nullable: true })
  currentPeriodStart?: Date | null

  @Property({ name: 'current_period_end', type: Date, nullable: true })
  currentPeriodEnd?: Date | null

  @Property({ name: 'trial_ends_at', type: Date, nullable: true })
  trialEndsAt?: Date | null

  @Property({ name: 'cancel_at_period_end', type: 'boolean' })
  cancelAtPeriodEnd: boolean = false

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'last_provider_event_at', type: Date, nullable: true })
  lastProviderEventAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'subscription_billing_records' })
@Index({ properties: ['organizationId', 'tenantId', 'subscription'] })
@Unique({
  name: 'subscription_billing_invoice_status_unique',
  properties: ['providerKey', 'providerInvoiceId', 'status'],
})
export class SubscriptionBillingRecord {
  [OptionalProps]?:
    | 'providerInvoiceId'
    | 'providerPaymentIntentId'
    | 'providerChargeId'
    | 'periodStart'
    | 'periodEnd'
    | 'processedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => Subscription, { fieldName: 'subscription_id' })
  subscription!: Subscription

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'provider_invoice_id', type: 'text', nullable: true })
  providerInvoiceId?: string | null

  @Property({ name: 'provider_payment_intent_id', type: 'text', nullable: true })
  providerPaymentIntentId?: string | null

  @Property({ name: 'provider_charge_id', type: 'text', nullable: true })
  providerChargeId?: string | null

  @Property({ name: 'status', type: 'text' })
  status!: 'paid' | 'failed' | 'void' | 'refunded' | 'unknown'

  @Property({ name: 'amount_minor', type: 'int' })
  amountMinor!: number

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'period_start', type: Date, nullable: true })
  periodStart?: Date | null

  @Property({ name: 'period_end', type: Date, nullable: true })
  periodEnd?: Date | null

  @Property({ name: 'event_type', type: 'text' })
  eventType!: string

  @Property({ name: 'processed_at', type: Date, onCreate: () => new Date() })
  processedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
