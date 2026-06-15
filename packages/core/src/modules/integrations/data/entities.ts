import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'sync_external_id_mappings' })
@Index({ properties: ['internalEntityType', 'internalEntityId', 'organizationId'] })
@Index({ properties: ['integrationId', 'externalId', 'organizationId'] })
export class SyncExternalIdMapping {
  [OptionalProps]?: 'syncStatus' | 'lastSyncedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'internal_entity_type', type: 'text' })
  internalEntityType!: string

  @Property({ name: 'internal_entity_id', type: 'uuid' })
  internalEntityId!: string

  @Property({ name: 'external_id', type: 'text' })
  externalId!: string

  @Property({ name: 'sync_status', type: 'text', default: 'not_synced' })
  syncStatus: 'synced' | 'pending' | 'error' | 'not_synced' = 'not_synced'

  @Property({ name: 'last_synced_at', type: Date, nullable: true })
  lastSyncedAt?: Date | null

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

@Entity({ tableName: 'integration_credentials' })
@Index({ properties: ['integrationId', 'organizationId', 'tenantId'] })
@Index({
  name: 'integration_credentials_user_lookup_idx',
  expression:
    `create unique index "integration_credentials_user_lookup_idx" on "integration_credentials" ("integration_id", "organization_id", "tenant_id", "user_id") where "user_id" is not null and "deleted_at" is null`,
})
export class IntegrationCredentials {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'userId'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'credentials', type: 'json' })
  credentials!: Record<string, unknown>

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /**
   * Per-user secret scoping (additive — added by the email integration spec).
   *
   * NULL = tenant-wide secret (existing behaviour, e.g. shared WhatsApp Business token).
   * Set  = per-user secret (e.g. Jane's personal Gmail OAuth refresh token).
   *
   * Cross-module link to `auth:user` is declared in
   * `packages/core/src/modules/communication_channels/data/extensions.ts` via
   * `EntityExtension` — no raw FOREIGN KEY constraint (root `AGENTS.md` rule:
   * "No direct ORM relationships between modules"). App-layer query callers
   * MUST scope by `user_id` on every per-user credential read.
   */
  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'integration_states' })
@Index({ properties: ['integrationId', 'organizationId', 'tenantId'] })
export class IntegrationState {
  [OptionalProps]?: 'isEnabled' | 'apiVersion' | 'reauthRequired' | 'lastHealthStatus' | 'lastHealthCheckedAt' | 'lastHealthLatencyMs' | 'enabledAt' | 'createdAt' | 'updatedAt' | 'deletedAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'api_version', type: 'text', nullable: true })
  apiVersion?: string | null

  @Property({ name: 'reauth_required', type: 'boolean', default: false })
  reauthRequired: boolean = false

  @Property({ name: 'last_health_status', type: 'text', nullable: true })
  lastHealthStatus?: 'healthy' | 'degraded' | 'unhealthy' | null

  @Property({ name: 'last_health_checked_at', type: Date, nullable: true })
  lastHealthCheckedAt?: Date | null

  @Property({ name: 'last_health_latency_ms', type: 'int', nullable: true })
  lastHealthLatencyMs?: number | null

  @Property({ name: 'enabled_at', type: Date, nullable: true })
  enabledAt?: Date | null

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

@Entity({ tableName: 'integration_logs' })
@Index({ properties: ['integrationId', 'organizationId', 'tenantId', 'createdAt'] })
@Index({ properties: ['level', 'organizationId', 'tenantId', 'createdAt'] })
export class IntegrationLog {
  [OptionalProps]?: 'runId' | 'scopeEntityType' | 'scopeEntityId' | 'code' | 'payload' | 'createdAt'
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null

  @Property({ name: 'scope_entity_type', type: 'text', nullable: true })
  scopeEntityType?: string | null

  @Property({ name: 'scope_entity_id', type: 'uuid', nullable: true })
  scopeEntityId?: string | null

  @Property({ name: 'level', type: 'text' })
  level!: 'info' | 'warn' | 'error'

  @Property({ name: 'message', type: 'text' })
  message!: string

  @Property({ name: 'code', type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'payload', type: 'json', nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
