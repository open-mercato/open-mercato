import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core'

@Entity({ tableName: 'sso_configs' })
// Unique index on organization_id (partial: WHERE deleted_at IS NULL) — managed by migration
export class SsoConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text' })
  protocol!: string

  @Property({ type: 'text', nullable: true })
  issuer?: string | null

  @Property({ name: 'client_id', type: 'text', nullable: true })
  clientId?: string | null

  @Property({ name: 'client_secret_enc', type: 'text', nullable: true })
  clientSecretEnc?: string | null

  @Property({ name: 'allowed_domains', type: 'jsonb', default: '[]' })
  allowedDomains: string[] = []

  @Property({ name: 'jit_enabled', type: 'boolean', default: true })
  jitEnabled: boolean = true

  @Property({ name: 'auto_link_by_email', type: 'boolean', default: true })
  autoLinkByEmail: boolean = true

  @Property({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean = false

  @Property({ name: 'sso_required', type: 'boolean', default: false })
  ssoRequired: boolean = false

  @Property({ name: 'app_role_mappings', type: 'jsonb', default: '{}' })
  appRoleMappings: Record<string, string> = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sso_identities' })
// Unique indexes (partial: WHERE deleted_at IS NULL) — managed by migration
export class SsoIdentity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'sso_config_id', type: 'uuid' })
  @Index({ name: 'sso_identities_config_id_idx' })
  ssoConfigId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index({ name: 'sso_identities_user_id_idx' })
  userId!: string

  @Property({ name: 'idp_subject', type: 'text' })
  idpSubject!: string

  @Property({ name: 'idp_email', type: 'text' })
  idpEmail!: string

  @Property({ name: 'idp_name', type: 'text', nullable: true })
  idpName?: string | null

  @Property({ name: 'idp_groups', type: 'jsonb', default: '[]' })
  idpGroups: string[] = []

  @Property({ name: 'external_id', type: 'text', nullable: true })
  externalId?: string | null

  @Property({ name: 'provisioning_method', type: 'text' })
  provisioningMethod!: string

  @Property({ name: 'first_login_at', type: Date, nullable: true })
  firstLoginAt?: Date | null

  @Property({ name: 'last_login_at', type: Date, nullable: true })
  lastLoginAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'scim_tokens' })
@Index({ name: 'scim_tokens_token_prefix_idx', properties: ['tokenPrefix'] })
export class ScimToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'sso_config_id', type: 'uuid' })
  @Index({ name: 'scim_tokens_sso_config_id_idx' })
  ssoConfigId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  @Property({ name: 'token_prefix', type: 'text' })
  tokenPrefix!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sso_user_deactivations' })
@Unique({ properties: ['userId', 'ssoConfigId'], name: 'sso_user_deactivations_user_config_unique' })
export class SsoUserDeactivation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index({ name: 'sso_user_deactivations_user_id_idx' })
  userId!: string

  @Property({ name: 'sso_config_id', type: 'uuid' })
  ssoConfigId!: string

  @Property({ name: 'deactivated_at', type: Date })
  deactivatedAt: Date = new Date()

  @Property({ name: 'reactivated_at', type: Date, nullable: true })
  reactivatedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'scim_provisioning_log' })
@Index({ name: 'scim_provisioning_log_config_created_idx', properties: ['ssoConfigId', 'createdAt'] })
export class ScimProvisioningLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'sso_config_id', type: 'uuid' })
  ssoConfigId!: string

  @Property({ type: 'text' })
  operation!: string

  @Property({ name: 'resource_type', type: 'text' })
  resourceType!: string

  @Property({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId?: string | null

  @Property({ name: 'scim_external_id', type: 'text', nullable: true })
  scimExternalId?: string | null

  @Property({ name: 'response_status', type: 'integer' })
  responseStatus!: number

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'sso_role_grants' })
@Unique({ properties: ['userId', 'roleId', 'ssoConfigId'], name: 'sso_role_grants_user_role_config_unique' })
export class SsoRoleGrant {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'user_id', type: 'uuid' })
  @Index({ name: 'sso_role_grants_user_id_idx' })
  userId!: string

  @Property({ name: 'role_id', type: 'uuid' })
  roleId!: string

  @Property({ name: 'sso_config_id', type: 'uuid' })
  ssoConfigId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
