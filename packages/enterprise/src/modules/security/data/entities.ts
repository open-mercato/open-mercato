import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
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

  @Property({ name: 'scope_tenant_id', type: 'uuid', nullable: true })
  scopeTenantId?: string | null

  @Property({ name: 'scope_organization_id', type: 'uuid', nullable: true })
  scopeOrganizationId?: string | null

  @Property({ name: 'target_identifier', type: 'text', nullable: true })
  targetIdentifier?: string | null

  @Property({ name: 'sudo_config_id', type: 'uuid', nullable: true })
  sudoConfigId?: string | null

  @Property({ name: 'sudo_config_updated_at', type: Date, nullable: true })
  sudoConfigUpdatedAt?: Date | null

  @Property({ name: 'session_token', type: 'text' })
  sessionToken!: string

  @Property({ name: 'challenge_method', type: 'text' })
  challengeMethod!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'verified_at', type: Date, nullable: true })
  verifiedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'mfa_challenges' })
@Index({ name: 'idx_mfa_challenges_lookup', properties: ['id', 'expiresAt'] })
@Unique({ name: 'mfa_challenges_tenant_sign_in_attempt_unique', properties: ['tenantId', 'signInAttemptId'] })
export class MfaChallenge {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'sign_in_attempt_id', type: 'uuid', nullable: true })
  signInAttemptId?: string | null

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

export type SignInResult = 'success' | 'failure'
export type SignInDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'
export type SignInMfaReceiptStatus = 'not_required' | 'enrollment_required' | 'bypassed' | 'pending' | 'verified'
export type SignInMfaStatus = SignInMfaReceiptStatus | 'unknown'
export type SignInNotificationIntentStatus = 'pending' | 'delivered' | 'suppressed'

@Entity({ tableName: 'security_sign_in_attempts' })
@Unique({ name: 'sec_sign_in_attempt_source_unique', properties: ['tenantId', 'sourceAttemptId'] })
@Index({ name: 'sec_sign_in_attempt_tenant_occurred', properties: ['tenantId', 'occurredAt'] })
@Index({ name: 'sec_sign_in_attempt_tenant_user_occurred', properties: ['tenantId', 'userId', 'occurredAt'] })
@Index({ name: 'sec_sign_in_attempt_tenant_ip_hash', properties: ['tenantId', 'ipHash'] })
@Index({ name: 'sec_sign_in_attempt_occurred', properties: ['occurredAt'] })
export class SignInAttempt {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'source_attempt_id', type: 'uuid' })
  sourceAttemptId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'email_hash', type: 'text' })
  emailHash!: string

  @Property({ type: 'text' })
  result!: SignInResult

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'ip_address', type: 'text', nullable: true })
  ipAddress?: string | null

  @Property({ name: 'ip_hash', type: 'text', nullable: true })
  ipHash?: string | null

  @Property({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string | null

  @Property({ name: 'browser_name', type: 'text', nullable: true })
  browserName?: string | null

  @Property({ name: 'browser_major', type: 'text', nullable: true })
  browserMajor?: string | null

  @Property({ name: 'os_name', type: 'text', nullable: true })
  osName?: string | null

  @Property({ name: 'device_type', type: 'text' })
  deviceType!: SignInDeviceType

  @Property({ name: 'device_key', type: 'text' })
  deviceKey!: string

  @Property({ name: 'is_new_device', type: 'boolean', default: false })
  isNewDevice = false

  @Property({ name: 'mfa_status', type: 'text', nullable: true })
  mfaStatus?: SignInMfaStatus | null

  @Property({ name: 'occurred_at', type: Date })
  occurredAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'security_known_devices' })
@Unique({ name: 'sec_known_device_identity_unique', properties: ['tenantId', 'userId', 'deviceKey'] })
@Index({ name: 'sec_known_device_last_seen', properties: ['lastSeenAt'] })
export class KnownDevice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'device_key', type: 'text' })
  deviceKey!: string

  @Property({ name: 'first_seen_at', type: Date })
  firstSeenAt!: Date

  @Property({ name: 'last_seen_at', type: Date })
  lastSeenAt!: Date
}

@Entity({ tableName: 'security_sign_in_mfa_receipts' })
@Unique({ name: 'sec_sign_in_mfa_receipt_source_unique', properties: ['tenantId', 'sourceAttemptId'] })
@Unique({ name: 'sec_sign_in_mfa_receipt_challenge_unique', properties: ['tenantId', 'challengeId'] })
@Index({ name: 'sec_sign_in_mfa_receipt_created', properties: ['createdAt'] })
export class SignInMfaReceipt {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'source_attempt_id', type: 'uuid' })
  sourceAttemptId!: string

  @Property({ name: 'challenge_id', type: 'uuid', nullable: true })
  challengeId?: string | null

  @Property({ type: 'text' })
  status!: SignInMfaReceiptStatus

  @Property({ name: 'verified_at', type: Date, nullable: true })
  verifiedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'security_sign_in_notification_intents' })
@Unique({ name: 'sec_sign_in_notification_device_unique', properties: ['tenantId', 'knownDeviceId'] })
@Index({ name: 'sec_sign_in_notification_status_created', properties: ['status', 'createdAt'] })
export class SignInNotificationIntent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'source_attempt_id', type: 'uuid' })
  sourceAttemptId!: string

  @Property({ name: 'known_device_id', type: 'uuid' })
  knownDeviceId!: string

  @Property({ type: 'text' })
  status!: SignInNotificationIntentStatus

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null
}
