import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

/**
 * Stores mappings between internal entity IDs and external system IDs.
 * Used by integration modules to track synced records across platforms.
 */
@Entity({ tableName: 'sync_external_id_mappings' })
@Index({ properties: ['internalEntityType', 'internalEntityId', 'organizationId'] })
@Index({ properties: ['integrationId', 'externalId', 'organizationId'] })
export class SyncExternalIdMapping {
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
@Unique({ properties: ['integrationId', 'tenantId', 'organizationId'] })
@Index({ properties: ['tenantId', 'organizationId'] })
export class IntegrationCredentials {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'credentials_json', type: 'jsonb', nullable: true })
  credentialsJson?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'integration_states' })
@Unique({ properties: ['integrationId', 'tenantId', 'organizationId'] })
@Index({ properties: ['tenantId', 'organizationId'] })
export class IntegrationState {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: false })
  isEnabled: boolean = false

  @Property({ name: 'selected_api_version', type: 'text', nullable: true })
  selectedApiVersion?: string | null

  @Property({ name: 'health_status', type: 'text', nullable: true })
  healthStatus?: 'healthy' | 'unhealthy' | 'unknown' | null

  @Property({ name: 'health_message', type: 'text', nullable: true })
  healthMessage?: string | null

  @Property({ name: 'health_checked_at', type: Date, nullable: true })
  healthCheckedAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'integration_logs' })
@Index({ properties: ['integrationId', 'tenantId', 'organizationId', 'createdAt'] })
@Index({ properties: ['correlationId'] })
export class IntegrationLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId?: string | null

  @Property({ name: 'level', type: 'text', default: 'info' })
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'

  @Property({ name: 'code', type: 'text' })
  code!: string

  @Property({ name: 'message', type: 'text' })
  message!: string

  @Property({ name: 'details_json', type: 'jsonb', nullable: true })
  detailsJson?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
