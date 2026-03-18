import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'gateway_transactions' })
@Index({ properties: ['paymentId', 'organizationId', 'tenantId'] })
@Index({ properties: ['providerKey', 'providerSessionId', 'organizationId'] })
@Index({ properties: ['organizationId', 'tenantId', 'unifiedStatus'] })
export class GatewayTransaction {
  [OptionalProps]?: 'unifiedStatus' | 'gatewayStatus' | 'providerSessionId' | 'gatewayPaymentId' | 'gatewayRefundId' | 'redirectUrl' | 'clientSecret' | 'gatewayMetadata' | 'webhookLog' | 'lastWebhookAt' | 'lastPolledAt' | 'expiresAt' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'payment_id', type: 'uuid' })
  paymentId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'provider_session_id', type: 'text', nullable: true })
  providerSessionId?: string | null

  @Property({ name: 'gateway_payment_id', type: 'text', nullable: true })
  gatewayPaymentId?: string | null

  @Property({ name: 'gateway_refund_id', type: 'text', nullable: true })
  gatewayRefundId?: string | null

  @Property({ name: 'unified_status', type: 'text' })
  unifiedStatus: string = 'pending'

  @Property({ name: 'gateway_status', type: 'text', nullable: true })
  gatewayStatus?: string | null

  @Property({ name: 'redirect_url', type: 'text', nullable: true })
  redirectUrl?: string | null

  @Property({ name: 'client_secret', type: 'text', nullable: true })
  clientSecret?: string | null

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4 })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'gateway_metadata', type: 'jsonb', nullable: true })
  gatewayMetadata?: Record<string, unknown> | null

  @Property({ name: 'webhook_log', type: 'jsonb', nullable: true })
  webhookLog?: Array<{ eventType: string; receivedAt: string; idempotencyKey: string; unifiedStatus: string; processed: boolean }> | null

  @Property({ name: 'last_webhook_at', type: Date, nullable: true })
  lastWebhookAt?: Date | null

  @Property({ name: 'last_polled_at', type: Date, nullable: true })
  lastPolledAt?: Date | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'gateway_webhook_events' })
@Index({
  name: 'gateway_webhook_events_idempotency_unique',
  properties: ['idempotencyKey', 'providerKey', 'organizationId', 'tenantId'],
  options: { unique: true },
})
export class WebhookProcessedEvent {
  [OptionalProps]?: 'processedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'event_type', type: 'text' })
  eventType!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'processed_at', type: Date, onCreate: () => new Date() })
  processedAt: Date = new Date()
}
