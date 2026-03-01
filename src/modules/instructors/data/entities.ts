import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OptionalProps,
} from '@mikro-orm/core'

export type CredentialType = 'unreal_engine' | 'credly' | 'other'
export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'expired'

@Entity({ tableName: 'instructor_profiles' })
@Index({ name: 'instructor_profiles_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'idx_ip_tenant_org_active',
  expression:
    `create index "idx_ip_tenant_org_active" on "instructor_profiles" ("tenant_id", "organization_id", "id") where deleted_at is null and is_active = true`,
})
@Unique({ name: 'instructor_profiles_tenant_slug_uniq', properties: ['tenantId', 'slug'] })
@Unique({ name: 'instructor_profiles_tenant_user_uniq', properties: ['tenantId', 'userId'] })
export class InstructorProfile {
  [OptionalProps]?: 'isActive' | 'isAvailable' | 'isVerified' | 'currency' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text', nullable: true })
  bio?: string | null

  @Property({ type: 'text', nullable: true })
  headline?: string | null

  @Property({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl?: string | null

  @Property({ type: 'jsonb', nullable: true })
  specializations?: string[] | null

  @Property({ name: 'experience_years', type: 'int', nullable: true })
  experienceYears?: number | null

  @Property({ name: 'hourly_rate', type: 'numeric', nullable: true })
  hourlyRate?: string | null

  @Property({ type: 'text', default: 'USD' })
  currency!: string

  @Property({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean

  @Property({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean

  @Property({ name: 'website_url', type: 'text', nullable: true })
  websiteUrl?: string | null

  @Property({ name: 'github_url', type: 'text', nullable: true })
  githubUrl?: string | null

  @Property({ name: 'linkedin_url', type: 'text', nullable: true })
  linkedinUrl?: string | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'instructor_credentials' })
@Index({ name: 'instructor_credentials_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'instructor_credentials_instructor_idx', properties: ['instructorId'] })
export class InstructorCredential {
  [OptionalProps]?: 'verificationStatus' | 'sortOrder' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string

  @Property({ name: 'credential_url', type: 'text' })
  credentialUrl!: string

  @Property({ name: 'credential_type', type: 'text' })
  credentialType!: CredentialType

  @Property({ type: 'text', nullable: true })
  title?: string | null

  @Property({ type: 'text', nullable: true })
  issuer?: string | null

  @Property({ name: 'badge_image_url', type: 'text', nullable: true })
  badgeImageUrl?: string | null

  @Property({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt?: Date | null

  @Property({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'verification_status', type: 'text', default: 'pending' })
  verificationStatus!: VerificationStatus

  @Property({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
