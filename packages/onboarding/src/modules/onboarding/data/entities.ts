import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core'

type OnboardingStatus = 'pending' | 'completed' | 'expired'

@Entity({ tableName: 'onboarding_requests' })
@Unique({ properties: ['email'] })
@Unique({ properties: ['tokenHash'] })
export class OnboardingRequest {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  @Property({ type: 'text', default: 'pending' })
  status: OnboardingStatus = 'pending'

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Property({ name: 'organization_name', type: 'text' })
  organizationName!: string

  @Property({ type: 'text', nullable: true })
  locale?: string | null

  @Property({ name: 'terms_accepted', type: 'boolean', default: false })
  termsAccepted: boolean = false

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'last_email_sent_at', type: Date, nullable: true })
  lastEmailSentAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type { OnboardingStatus }
