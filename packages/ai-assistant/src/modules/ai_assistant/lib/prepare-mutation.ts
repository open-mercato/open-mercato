import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AiAgentDefinition, AiAgentMutationPolicy } from './ai-agent-definition'
import type { AiChatRequestContext, AiUiPart } from './attachment-bridge-types'
import type {
  AiToolDefinition,
  AiToolLoadBeforeRecord,
  AiToolLoadBeforeSingleRecord,
  McpToolContext,
} from './types'
import { resolveEffectiveMutationPolicy } from './agent-policy'
import { AiPendingActionRepository } from '../data/repositories/AiPendingActionRepository'
import type { AiPendingAction } from '../data/entities'
import type {
  AiPendingActionFieldDiff,
  AiPendingActionRecordDiff,
} from './pending-action-types'

/**
 * Structured error raised by {@link prepareMutation}. Callers (today the
 * agent-runtime tool wrapper installed by `resolveAiAgentTools`) turn this
 * into a tool-call failure that the model surfaces back to the user without
 * leaking internals. The runtime NEVER reaches this helper when the agent
 * is declared read-only — the policy gate rejects the tool call upstream —
 * but we keep the fail-closed check as a defensive guard.
 */
export class AiMutationPreparationError extends Error {
  constructor(
    public readonly code:
      | 'not_a_mutation_tool'
      | 'read_only_agent'
      | 'tenant_scope_missing'
      | 'container_missing'
      | 'em_missing',
    message: string,
  ) {
    super(message)
    this.name = 'AiMutationPreparationError'
  }
}

export interface PrepareMutationInput {
  agent: AiAgentDefinition
  tool: AiToolDefinition
  toolCallArgs: Record<string, unknown>
  conversationId?: string | null
  /**
   * Optional downgrade the caller already resolved (mirror of
   * `resolveAiAgentTools({ mutationPolicyOverride })`). When omitted, the
   * agent's code-declared policy stands alone.
   */
  mutationPolicyOverride?: AiAgentMutationPolicy | null
  /**
   * Deterministic clock hook for tests. Defaults to `new Date()`.
   */
  now?: Date
}

export interface PrepareMutationContext extends AiChatRequestContext {
  container: AwilixContainer
}

export interface PrepareMutationResult {
  uiPart: AiUiPart
  pendingAction: AiPendingAction
}

const MUTATION_PREVIEW_CARD_COMPONENT_ID = 'mutation-preview-card'

const NO_RESOLVER_SIDE_EFFECTS_MESSAGE =
  'Tool did not declare a field-diff resolver; action will proceed without a preview.'

function assertTenantScope(ctx: PrepareMutationContext): string {
  if (!ctx.tenantId) {
    throw new AiMutationPreparationError(
      'tenant_scope_missing',
      'prepareMutation requires a tenant-scoped request context.',
    )
  }
  return ctx.tenantId
}

function resolveEm(container: AwilixContainer): EntityManager {
  if (!container) {
    throw new AiMutationPreparationError(
      'container_missing',
      'prepareMutation requires an Awilix container to resolve the EntityManager.',
    )
  }
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) {
    throw new AiMutationPreparationError(
      'em_missing',
      'prepareMutation could not resolve "em" from the container.',
    )
  }
  return em
}

function toolHandlerContext(ctx: PrepareMutationContext): McpToolContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    container: ctx.container,
    userFeatures: ctx.features,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, raw) => {
    if (raw && typeof raw === 'object') {
      if (seen.has(raw as object)) return '[Circular]'
      seen.add(raw as object)
      const entries = Object.entries(raw as Record<string, unknown>)
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return entries.reduce<Record<string, unknown>>((acc, [k, v]) => {
        acc[k] = v
        return acc
      }, {})
    }
    return raw
  })
}

/**
 * Hashes `(tenantId, orgId, agentId, conversationId, toolName, normalizedInput)`
 * into a stable SHA-256 digest so that retries of the same tool call with the
 * same payload collapse to a single `AiPendingAction` row inside the TTL
 * window. The input is normalized through `safeStringify` to make object key
 * order irrelevant (spec §8 rule `idempotencyKey prevents double-submission`).
 * Attachments are NOT included — the attachment set is captured separately on
 * the pending row so that re-uploading the same file set with a different
 * tool-call object never accidentally collides.
 */
export function computeMutationIdempotencyKey(input: {
  tenantId: string
  organizationId: string | null
  agentId: string
  conversationId: string | null
  toolName: string
  normalizedInput: Record<string, unknown>
}): string {
  const canonical = safeStringify({
    tenant: input.tenantId,
    org: input.organizationId ?? null,
    agent: input.agentId,
    conversation: input.conversationId ?? null,
    tool: input.toolName,
    input: input.normalizedInput ?? {},
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function computeFieldDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AiPendingActionFieldDiff[] {
  const diff: AiPendingActionFieldDiff[] = []
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])
  for (const field of keys) {
    const beforeValue = before ? before[field] : undefined
    const afterValue = after ? after[field] : undefined
    if (!Object.is(beforeValue, afterValue) && safeStringify(beforeValue) !== safeStringify(afterValue)) {
      diff.push({ field, before: beforeValue, after: afterValue })
    }
  }
  return diff
}

function extractPatchFromArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const raw = args?.patch
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  // Fall back: treat the whole args object (minus well-known envelope keys)
  // as the patch. This preserves compatibility with tools whose schema is
  // flat (`{ productId, name }`) rather than nested (`{ productId, patch }`).
  const envelope = new Set([
    'id',
    'recordId',
    'records',
    'attachmentIds',
    '_sessionToken',
  ])
  const reduced: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args ?? {})) {
    if (envelope.has(key)) continue
    reduced[key] = value
  }
  return reduced
}

function matchBatchPatch(
  args: Record<string, unknown>,
  recordId: string,
): Record<string, unknown> {
  const rawList = args?.records
  if (Array.isArray(rawList)) {
    const match = rawList.find((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const candidate = entry as Record<string, unknown>
      return candidate.recordId === recordId || candidate.id === recordId
    })
    if (match && typeof match === 'object') {
      const patch = (match as Record<string, unknown>).patch
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        return patch as Record<string, unknown>
      }
      const envelope = new Set(['recordId', 'id'])
      const reduced: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(match as Record<string, unknown>)) {
        if (envelope.has(key)) continue
        reduced[key] = value
      }
      return reduced
    }
  }
  return {}
}

function normalizeAttachmentIds(args: Record<string, unknown>): string[] {
  const raw = args?.attachmentIds
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

async function buildSingleRecordDiff(
  tool: AiToolDefinition,
  input: PrepareMutationInput,
  ctx: PrepareMutationContext,
): Promise<{
  fieldDiff: AiPendingActionFieldDiff[]
  targetEntityType: string | null
  targetRecordId: string | null
  recordVersion: string | null
  sideEffectsSummary: string | null
}> {
  const resolver = tool.loadBeforeRecord
  if (!resolver) {
    console.warn(
      `[AI Agents] prepareMutation: tool "${tool.name}" declared isMutation=true but no loadBeforeRecord resolver; shipping empty fieldDiff.`,
    )
    return {
      fieldDiff: [],
      targetEntityType: null,
      targetRecordId: null,
      recordVersion: null,
      sideEffectsSummary: NO_RESOLVER_SIDE_EFFECTS_MESSAGE,
    }
  }
  const handlerContext = toolHandlerContext(ctx)
  const before: AiToolLoadBeforeSingleRecord | null = await resolver(
    input.toolCallArgs as never,
    handlerContext,
  )
  if (!before) {
    return {
      fieldDiff: [],
      targetEntityType: null,
      targetRecordId: null,
      recordVersion: null,
      sideEffectsSummary: null,
    }
  }
  const patch = extractPatchFromArgs(input.toolCallArgs)
  const fieldDiff = computeFieldDiff(before.before, patch)
  return {
    fieldDiff,
    targetEntityType: before.entityType,
    targetRecordId: before.recordId,
    recordVersion: before.recordVersion,
    sideEffectsSummary: null,
  }
}

async function buildBatchRecords(
  tool: AiToolDefinition,
  input: PrepareMutationInput,
  ctx: PrepareMutationContext,
): Promise<{
  records: AiPendingActionRecordDiff[] | null
  targetEntityType: string | null
  sideEffectsSummary: string | null
}> {
  const resolver = tool.loadBeforeRecords
  if (!resolver) {
    console.warn(
      `[AI Agents] prepareMutation: bulk tool "${tool.name}" declared isMutation=true but no loadBeforeRecords resolver; shipping empty records[].`,
    )
    return {
      records: null,
      targetEntityType: null,
      sideEffectsSummary: NO_RESOLVER_SIDE_EFFECTS_MESSAGE,
    }
  }
  const handlerContext = toolHandlerContext(ctx)
  const rows: AiToolLoadBeforeRecord[] = await resolver(
    input.toolCallArgs as never,
    handlerContext,
  )
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      records: null,
      targetEntityType: null,
      sideEffectsSummary: null,
    }
  }
  const diffs: AiPendingActionRecordDiff[] = rows.map((row) => {
    const patch = matchBatchPatch(input.toolCallArgs, row.recordId)
    return {
      recordId: row.recordId,
      entityType: row.entityType,
      label: row.label,
      fieldDiff: computeFieldDiff(row.before, patch),
      recordVersion: row.recordVersion ?? null,
    }
  })
  const [firstEntity] = rows
  return {
    records: diffs,
    targetEntityType: firstEntity ? firstEntity.entityType : null,
    sideEffectsSummary: null,
  }
}

/**
 * Intercepts a mutation tool call and turns it into an `AiPendingAction` +
 * `mutation-preview-card` UI part (spec Phase 3 WS-C §9). The caller MUST
 * have already confirmed the agent's effective `mutationPolicy` is NOT
 * `read-only`; this helper repeats the check defensively because skipping it
 * would be a policy-bypass.
 *
 * The tool handler is NEVER invoked by this function — the write is
 * short-circuited and only runs from the Step 5.8 confirm route. See the
 * unit test `does not call the tool handler` for the guard.
 */
export async function prepareMutation(
  input: PrepareMutationInput,
  ctx: PrepareMutationContext,
): Promise<PrepareMutationResult> {
  const { agent, tool } = input
  if (tool.isMutation !== true) {
    throw new AiMutationPreparationError(
      'not_a_mutation_tool',
      `Tool "${tool.name}" is not a mutation tool; prepareMutation should not be invoked.`,
    )
  }
  const effectivePolicy = resolveEffectiveMutationPolicy(
    agent.mutationPolicy,
    input.mutationPolicyOverride ?? null,
    agent.id,
  )
  if (effectivePolicy === 'read-only') {
    throw new AiMutationPreparationError(
      'read_only_agent',
      `Agent "${agent.id}" has effective mutationPolicy=read-only; mutation tool "${tool.name}" cannot be prepared.`,
    )
  }

  const tenantId = assertTenantScope(ctx)
  const em = resolveEm(ctx.container)
  const repo = new AiPendingActionRepository(em)

  const isBulk = tool.isBulk === true
  let fieldDiff: AiPendingActionFieldDiff[] = []
  let records: AiPendingActionRecordDiff[] | null = null
  let targetEntityType: string | null = null
  let targetRecordId: string | null = null
  let recordVersion: string | null = null
  let sideEffectsSummary: string | null = null

  if (isBulk) {
    const batch = await buildBatchRecords(tool, input, ctx)
    records = batch.records
    targetEntityType = batch.targetEntityType
    sideEffectsSummary = batch.sideEffectsSummary
  } else {
    const single = await buildSingleRecordDiff(tool, input, ctx)
    fieldDiff = single.fieldDiff
    targetEntityType = single.targetEntityType
    targetRecordId = single.targetRecordId
    recordVersion = single.recordVersion
    sideEffectsSummary = single.sideEffectsSummary
  }

  const normalizedInput = input.toolCallArgs ?? {}
  const conversationId = input.conversationId ?? null
  const idempotencyKey = computeMutationIdempotencyKey({
    tenantId,
    organizationId: ctx.organizationId ?? null,
    agentId: agent.id,
    conversationId,
    toolName: tool.name,
    normalizedInput,
  })

  const pendingAction = await repo.create(
    {
      agentId: agent.id,
      toolName: tool.name,
      idempotencyKey,
      createdByUserId: ctx.userId,
      normalizedInput,
      conversationId,
      targetEntityType,
      targetRecordId,
      fieldDiff,
      records,
      sideEffectsSummary,
      recordVersion,
      attachmentIds: normalizeAttachmentIds(normalizedInput),
      now: input.now,
    },
    {
      tenantId,
      organizationId: ctx.organizationId ?? null,
      userId: ctx.userId,
    },
  )

  const uiPart: AiUiPart = {
    componentId: MUTATION_PREVIEW_CARD_COMPONENT_ID,
    props: {
      pendingActionId: pendingAction.id,
      expiresAt: pendingAction.expiresAt.toISOString(),
      ...(records ? { records } : { fieldDiff }),
      ...(sideEffectsSummary ? { sideEffectsSummary } : {}),
    },
  }

  return { uiPart, pendingAction }
}

export const MUTATION_PREVIEW_CARD_COMPONENT = MUTATION_PREVIEW_CARD_COMPONENT_ID
