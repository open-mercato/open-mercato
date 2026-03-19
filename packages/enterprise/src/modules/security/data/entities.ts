import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'
import {
  ChallengeMethod,
  EnforcementScope,
  MfaMethodType,
  SudoChallengeMethodUsed,
} from './constants'

export {
  ChallengeMethod,
  EnforcementScope,
  MfaMethodType,
  SudoChallengeMethodUsed,
} from './constants'

@Entity({ tableName: 'user_mfa_methods' })
@Index({ name: 'idx_user_mfa_methods_user_type', properties: ['userId', 'type', 'isActive'] })
@Index({ name: 'idx_user_mfa_methods_tenant', properties: ['tenantId'] })
export class UserMfaMethod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ type: 'text' })
  type!: string

  @Property({ type: 'text', nullable: true })
  label?: string | null

  @Property({ type: 'text', nullable: true })
  secret?: string | null

  @Property({ name: 'provider_metadata', type: 'jsonb', nullable: true })
  providerMetadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'mfa_recovery_codes' })
@Index({ name: 'idx_mfa_recovery_codes_user', properties: ['userId', 'isUsed'] })
export class MfaRecoveryCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'code_hash', type: 'text' })
  codeHash!: string

  @Property({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean = false

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'mfa_enforcement_policies' })
@Index({ name: 'idx_mfa_enforcement_scope', properties: ['scope', 'tenantId'] })
export class MfaEnforcementPolicy {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  scope!: EnforcementScope

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'is_enforced', type: 'boolean', default: true })
  isEnforced: boolean = true

  @Property({ name: 'allowed_methods', type: 'jsonb', nullable: true })
  allowedMethods?: string[] | null

  @Property({ name: 'enforcement_deadline', type: Date, nullable: true })
  enforcementDeadline?: Date | null

  @Property({ name: 'enforced_by', type: 'uuid' })
  enforcedBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sudo_challenge_configs' })
@Index({ name: 'idx_sudo_configs_target', properties: ['targetIdentifier'] })
export class SudoChallengeConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'label', type: 'text', nullable: true })
  label: string | null = null

  @Property({ name: 'target_identifier', type: 'text' })
  targetIdentifier!: string

  @Property({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean = true

  @Property({ name: 'is_developer_default', type: 'boolean', default: false })
  isDeveloperDefault: boolean = false

  @Property({ name: 'ttl_seconds', type: 'integer', default: 300 })
  ttlSeconds: number = 300

  @Property({ name: 'challenge_method', type: 'text', default: 'auto' })
  challengeMethod: ChallengeMethod = ChallengeMethod.AUTO

  @Property({ name: 'configured_by', type: 'uuid', nullable: true })
  configuredBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sudo_sessions' })
@Index({ name: 'idx_sudo_sessions_token', properties: ['sessionToken', 'expiresAt'] })
export class SudoSession {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'session_token', type: 'text' })
  sessionToken!: string

  @Property({ name: 'challenge_method', type: 'text' })
  challengeMethod!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'mfa_challenges' })
@Index({ name: 'idx_mfa_challenges_lookup', properties: ['id', 'expiresAt'] })
export class MfaChallenge {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'otp_code_hash', type: 'text', nullable: true })
  otpCodeHash?: string | null

  @Property({ name: 'method_type', type: 'text', nullable: true })
  methodType?: string | null

  @Property({ name: 'method_id', type: 'uuid', nullable: true })
  methodId?: string | null

  @Property({ name: 'provider_challenge', type: 'jsonb', nullable: true })
  providerChallenge?: Record<string, unknown> | null

  @Property({ type: 'integer', default: 0 })
  attempts: number = 0

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'verified_at', type: Date, nullable: true })
  verifiedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
