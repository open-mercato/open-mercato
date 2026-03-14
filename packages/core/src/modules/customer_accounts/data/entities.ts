import { Entity, PrimaryKey, Property, ManyToOne, Unique, Index } from '@mikro-orm/core'

@Entity({ tableName: 'customer_users' })
@Unique({ properties: ['tenantId', 'emailHash'], name: 'customer_users_tenant_email_hash_uniq' })
export class CustomerUser {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'email_hash', type: 'text' })
  @Index({ name: 'customer_users_email_hash_idx' })
  emailHash!: string

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ name: 'email_verified_at', type: Date, nullable: true })
  emailVerifiedAt?: Date | null

  @Property({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number = 0

  @Property({ name: 'locked_until', type: Date, nullable: true })
  lockedUntil?: Date | null

  @Property({ name: 'last_login_at', type: Date, nullable: true })
  lastLoginAt?: Date | null

  @Property({ name: 'person_entity_id', type: 'uuid', nullable: true })
  @Index({ name: 'customer_users_person_entity_idx' })
  personEntityId?: string | null

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  @Index({ name: 'customer_users_customer_entity_idx' })
  customerEntityId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_roles' })
@Unique({ properties: ['tenantId', 'slug'], name: 'customer_roles_tenant_slug_uniq' })
export class CustomerRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean = false

  @Property({ name: 'customer_assignable', type: 'boolean', default: false })
  customerAssignable: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_role_acls' })
@Unique({ properties: ['role', 'tenantId'], name: 'customer_role_acls_role_tenant_uniq' })
export class CustomerRoleAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerRole)
  role!: CustomerRole

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  @Property({ name: 'is_portal_admin', type: 'boolean', default: false })
  isPortalAdmin: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_user_roles' })
@Unique({ properties: ['user', 'role'], name: 'customer_user_roles_user_role_uniq' })
export class CustomerUserRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerUser)
  user!: CustomerUser

  @ManyToOne(() => CustomerRole)
  role!: CustomerRole

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_user_acls' })
@Unique({ properties: ['user', 'tenantId'], name: 'customer_user_acls_user_tenant_uniq' })
export class CustomerUserAcl {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerUser)
  user!: CustomerUser

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'features_json', type: 'json', nullable: true })
  featuresJson?: string[] | null

  @Property({ name: 'is_portal_admin', type: 'boolean', default: false })
  isPortalAdmin: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_user_sessions' })
@Index({ properties: ['tokenHash'], name: 'customer_user_sessions_token_hash_idx' })
export class CustomerUserSession {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerUser)
  user!: CustomerUser

  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  @Property({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress?: string | null

  @Property({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string | null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_user_email_verifications' })
@Index({ properties: ['token'], name: 'customer_user_email_verifications_token_idx' })
export class CustomerUserEmailVerification {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerUser)
  user!: CustomerUser

  @Property({ type: 'text' })
  token!: string

  @Property({ type: 'text', default: 'email_verification' })
  purpose: string = 'email_verification'

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_user_password_resets' })
@Index({ properties: ['token'], name: 'customer_user_password_resets_token_idx' })
export class CustomerUserPasswordReset {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CustomerUser)
  user!: CustomerUser

  @Property({ type: 'text' })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_user_invitations' })
@Index({ properties: ['token'], name: 'customer_user_invitations_token_idx' })
@Index({ properties: ['tenantId', 'emailHash'], name: 'customer_user_invitations_tenant_email_hash_idx' })
export class CustomerUserInvitation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'email_hash', type: 'text' })
  emailHash!: string

  @Property({ type: 'text' })
  token!: string

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'role_ids_json', type: 'json', nullable: true })
  roleIdsJson?: string[] | null

  @Property({ name: 'invited_by_user_id', type: 'uuid', nullable: true })
  invitedByUserId?: string | null

  @Property({ name: 'invited_by_customer_user_id', type: 'uuid', nullable: true })
  invitedByCustomerUserId?: string | null

  @Property({ name: 'display_name', type: 'text', nullable: true })
  displayName?: string | null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'accepted_at', type: Date, nullable: true })
  acceptedAt?: Date | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
