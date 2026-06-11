import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type DevicePlatform = 'ios' | 'android' | 'web'

@Entity({ tableName: 'user_devices' })
@Index({ name: 'user_devices_tenant_user_idx', properties: ['tenantId', 'userId'] })
@Index({
  name: 'user_devices_tenant_user_device_active_unique',
  expression:
    'create unique index "user_devices_tenant_user_device_active_unique" on "user_devices" ("tenant_id", "user_id", "device_id") where deleted_at is null',
})
export class UserDevice {
  [OptionalProps]?:
    | 'organizationId'
    | 'clientAppVersion'
    | 'osVersion'
    | 'pushToken'
    | 'pushProvider'
    | 'pushTokenUpdatedAt'
    | 'lastSeenAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'device_id', type: 'text' })
  deviceId!: string

  @Property({ name: 'platform', type: 'text' })
  platform!: DevicePlatform

  @Property({ name: 'client_app_version', type: 'text', nullable: true })
  clientAppVersion?: string | null

  @Property({ name: 'os_version', type: 'text', nullable: true })
  osVersion?: string | null

  @Property({ name: 'push_token', type: 'text', nullable: true })
  pushToken?: string | null

  @Property({ name: 'push_provider', type: 'text', nullable: true })
  pushProvider?: string | null

  @Property({ name: 'push_token_updated_at', type: Date, nullable: true })
  pushTokenUpdatedAt?: Date | null

  @Property({ name: 'last_seen_at', type: Date, onCreate: () => new Date() })
  lastSeenAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
