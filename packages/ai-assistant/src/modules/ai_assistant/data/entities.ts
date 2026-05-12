import { OptionalProps } from '@mikro-orm/core'
import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy'
import type {
  AiPendingActionExecutionResult,
  AiPendingActionFailedRecord,
  AiPendingActionFieldDiff,
  AiPendingActionQueueMode,
  AiPendingActionRecordDiff,
  AiPendingActionStatus,
} from '../lib/pending-action-types'

/**
 * Versioned additive prompt-override for a registered AI agent (Step 5.3).
 *
 * Each write creates a new row with `version = latest + 1`. Rows are never
 * updated in place — history is preserved so operators can roll back by
 * reading an earlier `version`. Column set is tenant/org-scoped per the
 * standard Open Mercato RBAC contract.
 *
 * `sections` holds additive text keyed by prompt section id. The runtime
 * composes the final `systemPrompt` via `composeSystemPromptWithOverride`
 * (see `lib/prompt-override-merge.ts`), which NEVER replaces a built-in
 * section — overrides are append-only by contract.
 */
@Entity({ tableName: 'ai_agent_prompt_overrides' })
@Index({
  name: 'ai_agent_prompt_overrides_tenant_org_agent_version_uq',
  expression:
    'create unique index "ai_agent_prompt_overrides_tenant_org_agent_version_uq" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version") where "organization_id" is not null',
})
@Index({
  name: 'ai_agent_prompt_overrides_tenant_agent_version_null_org_uq',
  expression:
    'create unique index "ai_agent_prompt_overrides_tenant_agent_version_null_org_uq" on "ai_agent_prompt_overrides" ("tenant_id", "agent_id", "version") where "organization_id" is null',
})
@Index({
  name: 'ai_agent_prompt_overrides_tenant_agent_idx',
  properties: ['tenantId', 'agentId'],
})
@Index({
  name: 'ai_agent_prompt_overrides_tenant_org_agent_version_idx',
  expression:
    'create index "ai_agent_prompt_overrides_tenant_org_agent_version_idx" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version" desc)',
})
export class AiAgentPromptOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'organizationId' | 'createdByUserId' | 'notes'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'agent_id', type: 'text' })
  agentId!: string

  @Property({ name: 'version', type: 'int' })
  version!: number

  @Property({ name: 'sections', type: 'jsonb' })
  sections!: Record<string, string>

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Persistent mutation-approval gate row backing the Phase 3 WS-C contract
 * (spec §8 `AiPendingAction` + §9 confirm/cancel flow, Step 5.5).
 *
 * One row is created by `prepareMutation` (Step 5.6) whenever the runtime
 * intercepts an `isMutation: true` tool call from a non-read-only agent.
 * The row stores the normalized tool input, a precomputed `fieldDiff` (or
 * per-record batch diff in `records[]`), the target record version, an
 * `idempotencyKey` that dedupes double-submits within the TTL, and a
 * `status` that walks the state machine defined in
 * {@link AI_PENDING_ACTION_ALLOWED_TRANSITIONS}.
 *
 * The cleanup worker (Step 5.12) sweeps `status='pending' AND expiresAt < now`
 * rows and transitions them to `expired`. The confirm route (Step 5.8)
 * walks `pending → confirmed → executing → (failed | terminal success)`.
 * Reads always flow through `findOneWithDecryption` /
 * `findWithDecryption`, even though no column is GDPR-flagged today, so
 * future encrypted columns (e.g. `normalizedInput`) are handled.
 */
@Entity({ tableName: 'ai_pending_actions' })
@Index({
  name: 'ai_pending_actions_tenant_org_idempotency_uq',
  expression:
    'create unique index "ai_pending_actions_tenant_org_idempotency_uq" on "ai_pending_actions" ("tenant_id", "organization_id", "idempotency_key") where "organization_id" is not null',
})
@Index({
  name: 'ai_pending_actions_tenant_idem_null_org_uq',
  expression:
    'create unique index "ai_pending_actions_tenant_idem_null_org_uq" on "ai_pending_actions" ("tenant_id", "idempotency_key") where "organization_id" is null',
})
@Index({
  name: 'ai_pending_actions_tenant_org_status_expires_idx',
  properties: ['tenantId', 'organizationId', 'status', 'expiresAt'],
})
@Index({
  name: 'ai_pending_actions_tenant_org_agent_status_idx',
  properties: ['tenantId', 'organizationId', 'agentId', 'status'],
})
export class AiPendingAction {
  [OptionalProps]?:
    | 'createdAt'
    | 'organizationId'
    | 'conversationId'
    | 'targetEntityType'
    | 'targetRecordId'
    | 'fieldDiff'
    | 'records'
    | 'failedRecords'
    | 'sideEffectsSummary'
    | 'recordVersion'
    | 'attachmentIds'
    | 'executionResult'
    | 'resolvedAt'
    | 'resolvedByUserId'
    | 'queueMode'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'agent_id', type: 'text' })
  agentId!: string

  @Property({ name: 'tool_name', type: 'text' })
  toolName!: string

  @Property({ name: 'conversation_id', type: 'text', nullable: true })
  conversationId?: string | null

  @Property({ name: 'target_entity_type', type: 'text', nullable: true })
  targetEntityType?: string | null

  @Property({ name: 'target_record_id', type: 'text', nullable: true })
  targetRecordId?: string | null

  @Property({ name: 'normalized_input', type: 'jsonb' })
  normalizedInput!: Record<string, unknown>

  @Property({ name: 'field_diff', type: 'jsonb', default: [] })
  fieldDiff: AiPendingActionFieldDiff[] = []

  @Property({ name: 'records', type: 'jsonb', nullable: true })
  records?: AiPendingActionRecordDiff[] | null

  @Property({ name: 'failed_records', type: 'jsonb', nullable: true })
  failedRecords?: AiPendingActionFailedRecord[] | null

  @Property({ name: 'side_effects_summary', type: 'text', nullable: true })
  sideEffectsSummary?: string | null

  @Property({ name: 'record_version', type: 'text', nullable: true })
  recordVersion?: string | null

  @Property({ name: 'attachment_ids', type: 'jsonb', default: [] })
  attachmentIds: string[] = []

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'status', type: 'text' })
  status!: AiPendingActionStatus

  @Property({ name: 'queue_mode', type: 'text', default: 'inline' })
  queueMode: AiPendingActionQueueMode = 'inline'

  @Property({ name: 'execution_result', type: 'jsonb', nullable: true })
  executionResult?: AiPendingActionExecutionResult | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null
}

/**
 * Per-tenant runtime override row that controls which provider, model, and
 * base URL the AI runtime uses for a given agent (or all agents when
 * `agent_id` is null).
 *
 * Resolution at query time: a non-null `agent_id` row takes precedence over
 * a null `agent_id` (tenant-wide) row for the same `(tenant_id,
 * organization_id)` scope. All value columns are nullable — an admin can
 * override just the provider, just the model, or any subset. A null value
 * means "inherit from the next source in the factory resolution chain."
 *
 * Soft-delete via `deleted_at` so the unique partial index and audit trail
 * remain intact across upsert operations.
 *
 * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
 */
@Entity({ tableName: 'ai_agent_runtime_overrides' })
@Index({
  name: 'ai_agent_runtime_overrides_tenant_org_agent_uq',
  expression:
    'create unique index "ai_agent_runtime_overrides_tenant_org_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id", "agent_id") where "deleted_at" is null and "organization_id" is not null and "agent_id" is not null',
})
@Index({
  name: 'ai_agent_runtime_overrides_tenant_agent_null_org_uq',
  expression:
    'create unique index "ai_agent_runtime_overrides_tenant_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id", "agent_id") where "deleted_at" is null and "organization_id" is null and "agent_id" is not null',
})
@Index({
  name: 'ai_agent_runtime_overrides_tenant_null_agent_null_org_uq',
  expression:
    'create unique index "ai_agent_runtime_overrides_tenant_null_agent_null_org_uq" on "ai_agent_runtime_overrides" ("tenant_id") where "deleted_at" is null and "organization_id" is null and "agent_id" is null',
})
@Index({
  name: 'ai_agent_runtime_overrides_tenant_org_null_agent_uq',
  expression:
    'create unique index "ai_agent_runtime_overrides_tenant_org_null_agent_uq" on "ai_agent_runtime_overrides" ("tenant_id", "organization_id") where "deleted_at" is null and "organization_id" is not null and "agent_id" is null',
})
@Index({
  name: 'ai_agent_runtime_overrides_tenant_idx',
  properties: ['tenantId'],
})
export class AiAgentRuntimeOverride {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'organizationId'
    | 'agentId'
    | 'providerId'
    | 'modelId'
    | 'baseUrl'
    | 'updatedByUserId'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'agent_id', columnType: 'varchar(128)', nullable: true })
  agentId?: string | null

  @Property({ name: 'provider_id', columnType: 'varchar(64)', nullable: true })
  providerId?: string | null

  @Property({ name: 'model_id', columnType: 'varchar(256)', nullable: true })
  modelId?: string | null

  @Property({ name: 'base_url', columnType: 'varchar(2048)', nullable: true })
  baseUrl?: string | null

  @Property({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Tenant-scoped override of an agent's declared `mutationPolicy` (Step 5.4).
 *
 * Unlike {@link AiAgentPromptOverride}, this surface is NOT versioned — it is
 * a single-value policy switch per `(tenantId, organizationId, agentId)`. The
 * runtime enforces the override as a DOWNGRADE only: the effective policy
 * equals the MOST RESTRICTIVE of `{ code-declared, override }`. Escalation is
 * a code-level change and is rejected at the route layer.
 *
 * Hierarchy (most restrictive → least): `read-only` < `destructive-confirm-required`
 * < `confirm-required`. The route never allows an override to widen the
 * code-declared policy.
 */
@Entity({ tableName: 'ai_agent_mutation_policy_overrides' })
@Index({
  name: 'ai_agent_mutation_policy_overrides_tenant_org_agent_uq',
  expression:
    'create unique index "ai_agent_mutation_policy_overrides_tenant_org_agent_uq" on "ai_agent_mutation_policy_overrides" ("tenant_id", "organization_id", "agent_id") where "organization_id" is not null',
})
@Index({
  name: 'ai_agent_mutation_policy_overrides_tenant_agent_null_org_uq',
  expression:
    'create unique index "ai_agent_mutation_policy_overrides_tenant_agent_null_org_uq" on "ai_agent_mutation_policy_overrides" ("tenant_id", "agent_id") where "organization_id" is null',
})
@Index({
  name: 'ai_agent_mutation_policy_overrides_tenant_agent_idx',
  properties: ['tenantId', 'agentId'],
})
export class AiAgentMutationPolicyOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'organizationId' | 'createdByUserId' | 'notes'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'agent_id', type: 'text' })
  agentId!: string

  @Property({ name: 'mutation_policy', type: 'text' })
  mutationPolicy!: string

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
