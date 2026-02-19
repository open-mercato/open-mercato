import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core'

@Entity({ tableName: 'sso_configs' })
@Unique({ properties: ['organizationId'], name: 'sso_configs_organization_id_unique' })
export class SsoConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

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

  @Property({ name: 'default_role_id', type: 'uuid', nullable: true })
  defaultRoleId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sso_identities' })
@Unique({ properties: ['ssoConfigId', 'userId'], name: 'sso_identities_config_user_unique' })
@Unique({ properties: ['ssoConfigId', 'idpSubject'], name: 'sso_identities_config_subject_unique' })
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
