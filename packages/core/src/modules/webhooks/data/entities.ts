import { Entity, PrimaryKey, Property, Index, OptionalProps } from '@mikro-orm/core'

export type WebhookDeliveryType = 'http' | 'sqs' | 'sns'
export type RetryBackoff = 'linear' | 'exponential'

export interface WebhookRetryConfig {
  maxRetries: number
  retryBackoff: RetryBackoff
  retryDelay: number
}

export interface HttpWebhookConfig {
  url: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
}

export interface SqsWebhookConfig {
  queueUrl: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  messageGroupId?: string
}

export interface SnsWebhookConfig {
  topicArn: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
}

export type WebhookConfig = HttpWebhookConfig | SqsWebhookConfig | SnsWebhookConfig

@Entity({ tableName: 'webhooks' })
@Index({ name: 'idx_webhooks_tenant', properties: ['tenantId'] })
@Index({ name: 'idx_webhooks_delivery_type', properties: ['deliveryType'] })
export class Webhook {
  [OptionalProps]?: 'active' | 'timeout' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 255 })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'delivery_type', type: 'varchar', length: 50 })
  deliveryType!: WebhookDeliveryType

  @Property({ type: 'jsonb' })
  config!: WebhookConfig

  @Property({ type: 'varchar', length: 255 })
  secret!: string

  @Property({ name: 'old_secret', type: 'varchar', length: 255, nullable: true })
  oldSecret?: string | null

  @Property({ name: 'old_secret_expires_at', type: Date, nullable: true })
  oldSecretExpiresAt?: Date | null

  @Property({ type: 'text[]' })
  events!: string[]

  @Property({ type: 'boolean', default: true })
  active: boolean = true

  @Property({ name: 'retry_config', type: 'jsonb' })
  retryConfig!: WebhookRetryConfig

  @Property({ type: 'integer', default: 10000 })
  timeout: number = 10000

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'last_triggered_at', type: Date, nullable: true })
  lastTriggeredAt?: Date | null
}
