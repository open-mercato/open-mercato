import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type {
  PhoneCallDirection,
  PhoneCallStatus,
  PhoneCallParticipantRole,
} from '@open-mercato/shared/modules/phone_calls/types'

export type PhoneCallIngestStatus = 'pending' | 'complete' | 'failed'

@Entity({ tableName: 'phone_calls' })
@Index({ name: 'phone_calls_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'phone_calls_provider_external_scope_uq',
  properties: ['providerKey', 'externalCallId', 'tenantId', 'organizationId'],
})
@Index({ name: 'phone_calls_org_started_at_idx', properties: ['organizationId', 'startedAt'] })
@Index({ name: 'phone_calls_org_status_idx', properties: ['organizationId', 'status'] })
@Index({
  name: 'phone_calls_communication_projection_id_idx',
  expression:
    'create index "phone_calls_communication_projection_id_idx" on "phone_calls" ("communication_projection_id") where "communication_projection_id" is not null',
})
export class PhoneCall {
  [OptionalProps]?: 'ingestStatus' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'integration_id', type: 'text', nullable: true })
  integrationId?: string | null

  @Property({ name: 'external_call_id', type: 'text' })
  externalCallId!: string

  @Property({ name: 'external_conversation_id', type: 'text', nullable: true })
  externalConversationId?: string | null

  @Property({ name: 'direction', type: 'text' })
  direction!: PhoneCallDirection

  @Property({ name: 'status', type: 'text' })
  status!: PhoneCallStatus

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'answered_at', type: Date, nullable: true })
  answeredAt?: Date | null

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Property({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds?: number | null

  @Property({ name: 'recording_url', type: 'text', nullable: true })
  recordingUrl?: string | null

  @Property({ name: 'recording_attachment_id', type: 'uuid', nullable: true })
  recordingAttachmentId?: string | null

  @Property({ name: 'active_transcript_version_id', type: 'uuid', nullable: true })
  activeTranscriptVersionId?: string | null

  @Property({ name: 'active_summary_version_id', type: 'uuid', nullable: true })
  activeSummaryVersionId?: string | null

  @Property({ name: 'communication_projection_id', type: 'uuid', nullable: true })
  communicationProjectionId?: string | null

  @Property({ name: 'provider_facts', type: 'jsonb', nullable: true })
  providerFacts?: Record<string, unknown> | null

  @Property({ name: 'raw_snapshot', type: 'jsonb', nullable: true })
  rawSnapshot?: Record<string, unknown> | null

  @Property({ name: 'ingest_status', type: 'text', default: 'pending' })
  ingestStatus: PhoneCallIngestStatus = 'pending'

  @Property({ name: 'last_ingested_at', type: Date, nullable: true })
  lastIngestedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'phone_call_participants' })
@Index({ name: 'phone_call_participants_call_idx', properties: ['phoneCallId'] })
@Index({ name: 'phone_call_participants_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
export class PhoneCallParticipant {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => PhoneCall, { fieldName: 'phone_call_id', deleteRule: 'cascade', mapToPk: true })
  phoneCallId!: string

  @Property({ name: 'provider_participant_id', type: 'text', nullable: true })
  providerParticipantId?: string | null

  @Property({ name: 'role', type: 'text' })
  role!: PhoneCallParticipantRole

  @Property({ name: 'phone_number', type: 'text', nullable: true })
  phoneNumber?: string | null

  @Property({ name: 'display_name', type: 'text', nullable: true })
  displayName?: string | null

  @Property({ name: 'email', type: 'text', nullable: true })
  email?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
