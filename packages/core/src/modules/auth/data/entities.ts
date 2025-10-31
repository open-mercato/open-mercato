import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text', unique: true })
  email!: string

  @Property({ type: 'text', nullable: true })
  name?: string

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'is_confirmed', type: 'boolean', default: true })
  isConfirmed: boolean = true

  @Property({ name: 'last_login_at', type: Date, nullable: true })
  lastLoginAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

@Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'roles' })
@Unique({ properties: ['tenantId', 'name'] })
export class Role {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'user_sidebar_preferences' })
@Unique({ properties: ['user', 'tenantId', 'organizationId', 'locale'] })
export class UserSidebarPreference {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text' })
  locale!: string

  @Property({ name: 'settings_json', type: 'json', nullable: true })
  settingsJson?: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'role_sidebar_preferences' })
@Unique({ properties: ['role', 'tenantId', 'locale'] })
export class RoleSidebarPreference {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ type: 'text' })
  locale!: string

  @Property({ name: 'settings_json', type: 'json', nullable: true })
  settingsJson?: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'user_roles' })
export class UserRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sessions' })
export class Session {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'password_resets' })
export class PasswordReset {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// RBAC: Role-level ACL
@Entity({ tableName: 'role_acls' })
export class RoleAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Role)
  role!: Role

  // Tenant scope is mandatory for ACL evaluation
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Feature list (string-based). Use JSON array to preserve order and allow wildcards like "example.*".
  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  // If true, user with this role can do everything regardless of features
  @Property({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin: boolean = false

  // Visible organizations within the tenant; null/empty means all organizations
  @Property({ name: 'organizations_json', type: 'json', nullable: true })
  organizationsJson?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// RBAC: Per-user ACL override
@Entity({ tableName: 'user_acls' })
export class UserAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => User)
  user!: User

  // Tenant scope is mandatory for ACL evaluation
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Feature list (string-based). Use JSON array to preserve order and allow wildcards like "example.*".
  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  // If true, this user can do everything regardless of features
  @Property({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin: boolean = false

  // Visible organizations within the tenant; null/empty means all organizations
  @Property({ name: 'organizations_json', type: 'json', nullable: true })
  organizationsJson?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
