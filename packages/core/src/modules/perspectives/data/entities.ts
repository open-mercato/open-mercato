import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'perspectives' })
@Index({ name: 'perspectives_user_scope_idx', properties: ['userId', 'tenantId', 'organizationId', 'tableId'] })
// Live-row uniqueness is owned by partial indexes; ordinary unique decorators cannot express these scope rules.
@Index({
  name: 'perspectives_live_user_org_uq',
  expression:
    'create unique index "perspectives_live_user_org_uq" on "perspectives" ("user_id", "tenant_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is not null',
})
@Index({
  name: 'perspectives_live_user_tenant_uq',
  expression:
    'create unique index "perspectives_live_user_tenant_uq" on "perspectives" ("user_id", "tenant_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is null',
})
@Index({
  name: 'perspectives_live_user_org_only_uq',
  expression:
    'create unique index "perspectives_live_user_org_only_uq" on "perspectives" ("user_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is not null',
})
@Index({
  name: 'perspectives_live_user_global_uq',
  expression:
    'create unique index "perspectives_live_user_global_uq" on "perspectives" ("user_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is null',
})
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
// Live-row uniqueness is owned by partial indexes; ordinary unique decorators cannot express these scope rules.
@Index({
  name: 'role_perspectives_live_role_org_uq',
  expression:
    'create unique index "role_perspectives_live_role_org_uq" on "role_perspectives" ("role_id", "tenant_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is not null',
})
@Index({
  name: 'role_perspectives_live_role_tenant_uq',
  expression:
    'create unique index "role_perspectives_live_role_tenant_uq" on "role_perspectives" ("role_id", "tenant_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is not null and "organization_id" is null',
})
@Index({
  name: 'role_perspectives_live_role_org_only_uq',
  expression:
    'create unique index "role_perspectives_live_role_org_only_uq" on "role_perspectives" ("role_id", "organization_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is not null',
})
@Index({
  name: 'role_perspectives_live_role_global_uq',
  expression:
    'create unique index "role_perspectives_live_role_global_uq" on "role_perspectives" ("role_id", "table_id", "name") where "deleted_at" is null and "tenant_id" is null and "organization_id" is null',
})
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
