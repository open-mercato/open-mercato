import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'gateway_transactions' })
@Index({ properties: ['providerKey', 'tenantId', 'organizationId'] })
@Index({ properties: ['paymentId', 'tenantId', 'organizationId'] })
@Unique({ properties: ['providerKey', 'providerSessionId', 'tenantId', 'organizationId'] })
export class GatewayTransaction {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'provider_version', type: 'text', nullable: true })
  providerVersion?: string | null

  @Property({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'provider_session_id', type: 'text' })
  providerSessionId!: string

  @Property({ name: 'provider_status', type: 'text', nullable: true })
  providerStatus?: string | null

  @Property({ name: 'unified_status', type: 'text', nullable: true })
  unifiedStatus?: string | null

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'captured_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  capturedAmount: string = '0'

  @Property({ name: 'refunded_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  refundedAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'provider_data', type: 'jsonb', nullable: true })
  providerData?: Record<string, unknown> | null

  @Property({ name: 'last_webhook_event_id', type: 'text', nullable: true })
  lastWebhookEventId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
