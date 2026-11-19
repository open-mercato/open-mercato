import { OptionalProps } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

// §5.6: `ai` and `both` stay reserved in the column so Phase 3 adds behaviour without a
// migration; the Release 5 write path accepts `rep | off` only (S10, D-R5-15).
export type AssistedSellingStoreMode = 'ai' | 'rep' | 'both' | 'off'

@Entity({ tableName: 'assisted_selling_store_settings' })
@Unique({
  name: 'assisted_selling_store_settings_scope_unique',
  properties: ['tenantId', 'organizationId', 'storeId'],
})
export class AssistedSellingStoreSettings {
  [OptionalProps]?:
    | 'mode'
    | 'aiProposalsRequireRepApproval'
    | 'proposalTtlSeconds'
    | 'maxProposalLines'
    | 'aiMaxProposalsPerThreadPerHour'
    | 'aiMaxTurnsPerThreadPerHour'
    | 'conversationRetentionDays'
    | 'idleCloseDays'
    | 'aiAgentUserId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'store_id', type: 'uuid' })
  storeId!: string

  @Property({ type: 'text', default: 'off' })
  mode: AssistedSellingStoreMode = 'off'

  @Property({ name: 'ai_proposals_require_rep_approval', type: 'boolean', default: false })
  aiProposalsRequireRepApproval: boolean = false

  @Property({ name: 'proposal_ttl_seconds', type: 'int', default: 259200 })
  proposalTtlSeconds: number = 259200

  @Property({ name: 'max_proposal_lines', type: 'int', default: 50 })
  maxProposalLines: number = 50

  @Property({ name: 'ai_max_proposals_per_thread_per_hour', type: 'int', default: 4 })
  aiMaxProposalsPerThreadPerHour: number = 4

  @Property({ name: 'ai_max_turns_per_thread_per_hour', type: 'int', default: 20 })
  aiMaxTurnsPerThreadPerHour: number = 20

  @Property({ name: 'conversation_retention_days', type: 'int', default: 365 })
  conversationRetentionDays: number = 365

  @Property({ name: 'idle_close_days', type: 'int', default: 30 })
  idleCloseDays: number = 30

  @Property({ name: 'ai_agent_user_id', type: 'uuid', nullable: true })
  aiAgentUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
