import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

// Admin settings
@Entity({ tableName: 'freighttech_tracking_settings' })
@Unique({ name: 'freighttech_tracking_settings_scope_unique', properties: ['organizationId', 'tenantId'] })
export class FreighttechTrackingSettings {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'api_key', type: 'text', default: '' })
  apiKey: string = ''

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
