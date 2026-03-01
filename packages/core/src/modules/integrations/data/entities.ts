import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

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
