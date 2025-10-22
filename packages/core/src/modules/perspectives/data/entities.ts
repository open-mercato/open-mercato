import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'perspectives' })
@Index({ name: 'perspectives_user_scope_idx', properties: ['userId', 'tenantId', 'organizationId', 'tableId'] })
@Unique({ properties: ['userId', 'tenantId', 'organizationId', 'tableId', 'name'] })
export class Perspective {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'table_id', type: 'text' })
  tableId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'settings_json', type: 'json' })
  settingsJson!: unknown

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'role_perspectives' })
@Index({ name: 'role_perspectives_role_scope_idx', properties: ['roleId', 'tenantId', 'organizationId', 'tableId'] })
@Unique({ properties: ['roleId', 'tenantId', 'organizationId', 'tableId', 'name'] })
export class RolePerspective {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'role_id', type: 'uuid' })
  roleId!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'table_id', type: 'text' })
  tableId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'settings_json', type: 'json' })
  settingsJson!: unknown

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
