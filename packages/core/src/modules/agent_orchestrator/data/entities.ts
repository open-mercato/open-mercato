import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentRunStatus = 'running' | 'ok' | 'error'

@Entity({ tableName: 'agent_runs' })
@Index({ name: 'agent_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_runs_agent_idx', properties: ['organizationId', 'agentId'] })
export class AgentRun {
  [OptionalProps]?:
    | 'status'
    | 'output'
    | 'resultKind'
    | 'errorMessage'
    | 'parentRunId'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  /**
   * Parent run that delegated to this one as a sub-agent (Phase 4 nested trace).
   * Nullable + additive: top-level runs leave it null. Populated for the
   * in-process `delegate_agent` path; OpenCode-NATIVE `task` delegation runs
   * sub-agents inside OpenCode (not via our runner), so per-sub-agent rows are a
   * documented follow-up for that path.
   */
  @Property({ name: 'parent_run_id', type: 'uuid', nullable: true })
  parentRunId?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentRunStatus = 'running'

  @Property({ name: 'input', type: 'jsonb' })
  input!: unknown

  @Property({ name: 'output', type: 'jsonb', nullable: true })
  output?: unknown | null

  @Property({ name: 'result_kind', type: 'varchar', length: 20, nullable: true })
  resultKind?: 'informative' | 'actionable' | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export type AgentProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_run_idx', properties: ['organizationId', 'runId'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'dispositionBy' | 'dispositionReason'
    | 'processId' | 'stepId' | 'confidence' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'payload', type: 'jsonb' })
  payload!: unknown

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'disposition', type: 'varchar', length: 20, default: 'pending' })
  disposition: AgentProposalDisposition = 'pending'

  @Property({ name: 'disposition_by', type: 'varchar', length: 100, nullable: true })
  dispositionBy?: string | null

  @Property({ name: 'disposition_reason', type: 'text', nullable: true })
  dispositionReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
