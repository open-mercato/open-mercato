import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'webhooks' })
@Index({ properties: ['organizationId', 'tenantId', 'isActive'] })
@Index({ properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class WebhookEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'url', type: 'text' })
  url!: string

  @Property({ name: 'secret', type: 'text' })
  secret!: string

  @Property({ name: 'previous_secret', type: 'text', nullable: true })
  previousSecret?: string | null

  @Property({ name: 'previous_secret_set_at', type: Date, nullable: true })
  previousSecretSetAt?: Date | null

  @Property({ name: 'subscribed_events', type: 'json' })
  subscribedEvents!: string[]

  @Property({ name: 'http_method', type: 'text', default: 'POST' })
  httpMethod: string = 'POST'

  @Property({ name: 'custom_headers', type: 'json', nullable: true })
  customHeaders?: Record<string, string> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'delivery_strategy', type: 'text', default: 'http' })
  deliveryStrategy: string = 'http'

  @Property({ name: 'strategy_config', type: 'json', nullable: true })
  strategyConfig?: Record<string, unknown> | null

  @Property({ name: 'max_retries', type: 'int', default: 10 })
  maxRetries: number = 10

  @Property({ name: 'timeout_ms', type: 'int', default: 15000 })
  timeoutMs: number = 15000

  @Property({ name: 'rate_limit_per_minute', type: 'int', default: 0 })
  rateLimitPerMinute: number = 0

  @Property({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number = 0

  @Property({ name: 'auto_disable_threshold', type: 'int', default: 100 })
  autoDisableThreshold: number = 100

  @Property({ name: 'last_success_at', type: Date, nullable: true })
  lastSuccessAt?: Date | null

  @Property({ name: 'last_failure_at', type: Date, nullable: true })
  lastFailureAt?: Date | null

  @Property({ name: 'integration_id', type: 'text', nullable: true })
  integrationId?: string | null

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

@Entity({ tableName: 'webhook_deliveries' })
@Index({ properties: ['webhookId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'createdAt'] })
@Index({ properties: ['webhookId', 'createdAt'] })
@Index({ properties: ['eventType', 'organizationId'] })
export class WebhookDeliveryEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'webhook_id', type: 'uuid' })
  webhookId!: string

  @Property({ name: 'event_type', type: 'text' })
  eventType!: string

  @Property({ name: 'message_id', type: 'text' })
  messageId!: string

  @Property({ name: 'payload', type: 'json' })
  payload!: Record<string, unknown>

  @Property({ name: 'status', type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ name: 'response_status', type: 'int', nullable: true })
  responseStatus?: number | null

  @Property({ name: 'response_body', type: 'text', nullable: true })
  responseBody?: string | null

  @Property({ name: 'response_headers', type: 'json', nullable: true })
  responseHeaders?: Record<string, string> | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'attempt_number', type: 'int', default: 0 })
  attemptNumber: number = 0

  @Property({ name: 'max_attempts', type: 'int', default: 10 })
  maxAttempts: number = 10

  @Property({ name: 'next_retry_at', type: Date, nullable: true })
  nextRetryAt?: Date | null

  @Property({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null

  @Property({ name: 'target_url', type: 'text' })
  targetUrl!: string

  @Property({ name: 'enqueued_at', type: Date })
  enqueuedAt: Date = new Date()

  @Property({ name: 'last_attempt_at', type: Date, nullable: true })
  lastAttemptAt?: Date | null

  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'webhook_inbound_receipts' })
@Unique({ name: 'webhook_inbound_receipts_endpoint_message_unique', properties: ['endpointId', 'messageId'] })
@Index({ properties: ['providerKey', 'createdAt'] })
export class WebhookInboundReceiptEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'endpoint_id', type: 'text' })
  endpointId!: string

  @Property({ name: 'message_id', type: 'text' })
  messageId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'event_type', type: 'text', nullable: true })
  eventType?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
