/**
 * Pending-action re-check contract (spec §9.4 / Step 5.8).
 *
 * The operator presses "Confirm" on a `mutation-preview-card`. The server
 * MUST re-verify every invariant before executing the wrapped tool — the
 * pending row was created at propose-time and agents / policies / record
 * versions can all drift between then and confirm. This module is the
 * single source of truth for that contract.
 *
 * The individual `check*` helpers are exported independently so the Step
 * 5.8 unit suite can exercise each guard in isolation. The orchestrator
 * {@link runPendingActionRechecks} stops at the first failure and returns
 * a structured denial the route turns into a JSON error envelope.
 *
 * This module is pure aside from DB reads; the caller owns the transaction
 * boundary. The Step 5.9 cancel route reuses {@link checkStatusAndExpiry}.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AiAgentDefinition } from './ai-agent-definition'
import type { AiToolDefinition, McpToolContext } from './types'
import type { AiPendingAction } from '../data/entities'
import {
  AI_RAW_TOOL_AGENT_ID,
  type AiPendingActionFailedRecord,
  type AiPendingActionRecordDiff,
  type AiPendingActionStatus,
} from './pending-action-types'
import { resolveEffectiveMutationPolicy } from './agent-policy'
import { hasRequiredFeatures } from './auth'
import { isToolExposed, resolveMcpExposureConfig, type McpExposureConfig } from './mcp-exposure'
import type { AiAgentMutationPolicy } from './ai-agent-definition'

export type PendingActionRecheckCode =
  | 'invalid_status'
  | 'expired'
  | 'agent_unknown'
  | 'agent_features_denied'
  | 'tool_not_whitelisted'
  | 'read_only_agent'
  | 'attachment_cross_tenant'
  | 'stale_version'
  | 'schema_drift'
  | 'tool_not_exposed'
  | 'approver_features_denied'
  | 'requester_revoked'
  | 'requester_features_denied'

export interface PendingActionRecheckOkResult {
  ok: true
  /**
   * Per-record stale list for batch mutations when only some records were
   * stale. Present only when the batch path produced a partial-stale set;
   * the caller should persist these via `repo.setStatus(..., { failedRecords })`
   * and proceed with the remaining records.
   */
  failedRecords?: AiPendingActionFailedRecord[]
}

export interface PendingActionRecheckFailResult {
  ok: false
  status: number
  code: PendingActionRecheckCode
  message: string
  extra?: Record<string, unknown>
}

export type PendingActionRecheckResult =
  | PendingActionRecheckOkResult
  | PendingActionRecheckFailResult

export interface PendingActionAuthContext {
  tenantId: string
  organizationId: string | null
  userId: string
  userFeatures: string[]
  isSuperAdmin: boolean
  /**
   * Optional DI container used by `checkRecordVersion` to hand the tool's
   * `loadBeforeRecord` resolver an `McpToolContext`.
   */
  container?: import('awilix').AwilixContainer
  em?: EntityManager
}

export interface PendingActionRecheckInput {
  action: AiPendingAction
  agent: AiAgentDefinition | null | undefined
  tool: AiToolDefinition | null | undefined
  ctx: PendingActionAuthContext
  /** Explicit clock for deterministic tests. */
  now?: Date
  /**
   * Optional tenant-scoped mutation-policy downgrade resolved by the caller
   * (Step 5.4). Missing / null → agent's code-declared policy stands alone.
   */
  mutationPolicyOverride?: AiAgentMutationPolicy | null
  /**
   * Exposure config used for raw MCP / tools-api rows. Defaults to the app
   * process's config resolved from `process.env`.
   */
  exposureConfig?: McpExposureConfig
}

/**
 * True for rows queued by a raw MCP / `/tools/execute` mutation call (Step
 * 3.3). These rows carry the synthetic {@link AI_RAW_TOOL_AGENT_ID} and skip
 * the agent guards in favour of the raw-tool guards below.
 */
export function isRawToolPendingAction(action: AiPendingAction): boolean {
  return (action.channel ?? 'agent') !== 'agent' && action.agentId === AI_RAW_TOOL_AGENT_ID
}

/**
 * Guards 3 + 2: pending action is still in `pending` and has not expired.
 * Returns a structured 409 on mismatch. Reused by the cancel route (which
 * only runs 1-3 of the re-check list).
 */
export function checkStatusAndExpiry(
  action: AiPendingAction,
  options: { now?: Date } = {},
): PendingActionRecheckResult {
  const now = options.now ?? new Date()
  if (action.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      code: 'invalid_status',
      message: `Pending action is in status "${action.status}"; expected "pending".`,
    }
  }
  const expiresAt =
    action.expiresAt instanceof Date ? action.expiresAt : new Date(action.expiresAt)
  if (expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      status: 409,
      code: 'expired',
      message: 'Pending action has expired. The model must re-propose the mutation.',
    }
  }
  return { ok: true }
}

/**
 * Guard 4: the agent is still registered AND the caller still carries the
 * agent's `requiredFeatures`. Missing agent → 404. Missing features → 403.
 */
export function checkAgentAndFeatures(
  agent: AiAgentDefinition | null | undefined,
  ctx: PendingActionAuthContext,
): PendingActionRecheckResult {
  if (!agent) {
    return {
      ok: false,
      status: 404,
      code: 'agent_unknown',
      message: 'Agent is no longer registered.',
    }
  }
  const required = agent.requiredFeatures ?? []
  if (!hasRequiredFeatures(required, ctx.userFeatures, ctx.isSuperAdmin)) {
    return {
      ok: false,
      status: 403,
      code: 'agent_features_denied',
      message: `Caller lacks one of the agent's required features: ${required.join(', ')}`,
    }
  }
  return { ok: true }
}

/**
 * Guards 5 + 6: effective mutation policy still allows mutation, AND the
 * tool is still whitelisted + still declared `isMutation: true`. Read-only
 * policy or whitelist drop → 403.
 */
export function checkToolWhitelist(
  agent: AiAgentDefinition,
  tool: AiToolDefinition | null | undefined,
  action: AiPendingAction,
  options: { mutationPolicyOverride?: AiAgentMutationPolicy | null } = {},
): PendingActionRecheckResult {
  if (!tool) {
    return {
      ok: false,
      status: 403,
      code: 'tool_not_whitelisted',
      message: `Tool "${action.toolName}" is not registered.`,
    }
  }
  if (!agent.allowedTools.includes(tool.name) || tool.isMutation !== true) {
    return {
      ok: false,
      status: 403,
      code: 'tool_not_whitelisted',
      message: `Tool "${tool.name}" is no longer whitelisted as a mutation tool for agent "${agent.id}".`,
    }
  }
  const effective = resolveEffectiveMutationPolicy(
    agent.mutationPolicy,
    options.mutationPolicyOverride ?? null,
    agent.id,
  )
  if (effective === 'read-only') {
    return {
      ok: false,
      status: 403,
      code: 'read_only_agent',
      message: `Agent "${agent.id}" effective mutationPolicy=read-only; mutation tool "${tool.name}" cannot be executed.`,
    }
  }
  return { ok: true }
}

/**
 * Raw-tool guard: the tool is still registered, still a mutation tool, and
 * still exposed by the app process's MCP exposure config.
 */
export function checkRawToolExposure(
  tool: AiToolDefinition | null | undefined,
  action: AiPendingAction,
  exposureConfig: McpExposureConfig,
): PendingActionRecheckResult {
  if (!tool || tool.isMutation !== true || !isToolExposed(tool, exposureConfig)) {
    return {
      ok: false,
      status: 403,
      code: 'tool_not_exposed',
      message: `Tool "${action.toolName}" is no longer exposed as a mutation tool.`,
    }
  }
  return { ok: true }
}

/**
 * Raw-tool guard: the approver holds every `requiredFeatures` entry of the
 * tool they are about to execute under their own identity.
 */
export function checkApproverToolFeatures(
  tool: AiToolDefinition,
  ctx: PendingActionAuthContext,
): PendingActionRecheckResult {
  const required = tool.requiredFeatures ?? []
  if (!hasRequiredFeatures(required, ctx.userFeatures, ctx.isSuperAdmin)) {
    return {
      ok: false,
      status: 403,
      code: 'approver_features_denied',
      message: `Approver lacks one of the tool's required features: ${required.join(', ')}`,
    }
  }
  return { ok: true }
}

function requesterRevoked(message: string): PendingActionRecheckFailResult {
  return { ok: false, status: 403, code: 'requester_revoked', message }
}

function requesterFeaturesDenied(required: string[]): PendingActionRecheckFailResult {
  return {
    ok: false,
    status: 403,
    code: 'requester_features_denied',
    message: `Requester no longer holds one of the tool's required features: ${required.join(', ')}`,
  }
}

/**
 * Raw-tool guard: the requester is still valid. When the row was queued
 * through an API key, the key must still exist, not be deleted and not be
 * expired. The requester's ACL (the API key ACL, else the creator user's
 * ACL) must still cover the tool's `requiredFeatures`.
 */
export async function checkRawToolRequester(
  action: AiPendingAction,
  tool: AiToolDefinition,
  ctx: PendingActionAuthContext,
  options: { now?: Date } = {},
): Promise<PendingActionRecheckResult> {
  const now = options.now ?? new Date()
  const container = ctx.container
  const em = ctx.em ?? (container ? container.resolve<EntityManager>('em') : undefined)
  let rbacService: RbacService | null = null
  try {
    rbacService = container ? container.resolve<RbacService>('rbacService') : null
  } catch {
    rbacService = null
  }
  const required = tool.requiredFeatures ?? []
  const apiKeyId = action.apiKeyId ?? null
  let principalId = action.createdByUserId
  let aclScope = { tenantId: action.tenantId, organizationId: action.organizationId ?? null }
  if (apiKeyId) {
    if (!em) return requesterRevoked('API key validity check requires an EntityManager.')
    const apiKey = await findOneWithDecryption<ApiKey>(
      em,
      ApiKey,
      { id: apiKeyId, deletedAt: null },
      {},
      { tenantId: action.tenantId, organizationId: action.organizationId ?? null },
    )
    if (!apiKey || apiKey.deletedAt || (apiKey.tenantId ?? null) !== action.tenantId) {
      return requesterRevoked('The API key that requested this action no longer exists.')
    }
    if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now.getTime()) {
      return requesterRevoked('The API key that requested this action has expired.')
    }
    principalId = `api_key:${apiKey.id}`
    aclScope = { tenantId: apiKey.tenantId ?? action.tenantId, organizationId: apiKey.organizationId ?? null }
  }
  if (!principalId) return requesterRevoked('The requester of this action is unknown.')
  if (!rbacService) return requesterFeaturesDenied(required)
  const requesterAcl = await rbacService.loadAcl(principalId, aclScope)
  if (!hasRequiredFeatures(required, requesterAcl.features, requesterAcl.isSuperAdmin)) {
    return requesterFeaturesDenied(required)
  }
  return { ok: true }
}

/**
 * Guard 7: every attachment id referenced by the pending row belongs to the
 * caller's tenant/org. Any cross-tenant id short-circuits with 403 — we do
 * not leak which specific id was rejected.
 */
export async function checkAttachmentScope(
  action: AiPendingAction,
  ctx: PendingActionAuthContext,
): Promise<PendingActionRecheckResult> {
  const ids = Array.isArray(action.attachmentIds) ? action.attachmentIds : []
  if (ids.length === 0) return { ok: true }
  const em = ctx.em
  if (!em) {
    return {
      ok: false,
      status: 500,
      code: 'attachment_cross_tenant',
      message: 'Attachment scope check requires an EntityManager.',
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await findWithDecryption<any>(
    em,
    Attachment as any,
    { id: { $in: ids } } as any,
    {},
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )) as Array<{ id: string; tenantId?: string | null; organizationId?: string | null }>
  if (rows.length !== ids.length) {
    return {
      ok: false,
      status: 403,
      code: 'attachment_cross_tenant',
      message: 'One or more attachments are not accessible to the caller.',
    }
  }
  for (const row of rows) {
    if ((row.tenantId ?? null) !== ctx.tenantId) {
      return {
        ok: false,
        status: 403,
        code: 'attachment_cross_tenant',
        message: 'One or more attachments belong to a different tenant.',
      }
    }
    if (ctx.organizationId !== null && row.organizationId && row.organizationId !== ctx.organizationId) {
      return {
        ok: false,
        status: 403,
        code: 'attachment_cross_tenant',
        message: 'One or more attachments belong to a different organization.',
      }
    }
  }
  return { ok: true }
}

/**
 * Guard 8: record version matches the row's captured `recordVersion`. For
 * single-record actions a mismatch is a hard 412. For batch actions we
 * compute per-record and return a `failedRecords[]` entry for each stale
 * record; the caller proceeds with the remaining records. If the batch
 * has NO remaining records (every one is stale) the function returns 412.
 *
 * Also acts as the schema-drift guard: re-parses `action.normalizedInput`
 * through the tool's current zod schema. A shape change between propose
 * and confirm surfaces as 412 `schema_drift` so the model re-proposes.
 */
export async function checkRecordVersion(
  action: AiPendingAction,
  tool: AiToolDefinition,
  ctx: PendingActionAuthContext,
): Promise<PendingActionRecheckResult> {
  const parseResult = tool.inputSchema.safeParse(action.normalizedInput ?? {})
  if (!parseResult.success) {
    return {
      ok: false,
      status: 412,
      code: 'schema_drift',
      message: 'Pending input no longer satisfies the tool schema.',
      extra: { issues: parseResult.error.issues },
    }
  }

  const handlerContext = toHandlerContext(ctx)

  const records = Array.isArray(action.records) ? action.records : null
  if (records && records.length > 0) {
    if (!tool.loadBeforeRecords) {
      return { ok: true }
    }
    const currentRows = await tool.loadBeforeRecords(parseResult.data as never, handlerContext)
    const currentVersionById = new Map<string, string | null>()
    for (const row of currentRows ?? []) {
      currentVersionById.set(row.recordId, row.recordVersion ?? null)
    }
    const stale: AiPendingActionFailedRecord[] = []
    for (const record of records as AiPendingActionRecordDiff[]) {
      const current = currentVersionById.get(record.recordId)
      const captured = record.recordVersion ?? null
      if (current === undefined) {
        stale.push({
          recordId: record.recordId,
          error: { code: 'stale_version', message: 'Record no longer exists.' },
        })
        continue
      }
      if (captured !== null && current !== captured) {
        stale.push({
          recordId: record.recordId,
          error: { code: 'stale_version', message: 'Record version changed since preview.' },
        })
      }
    }
    if (stale.length === records.length) {
      return {
        ok: false,
        status: 412,
        code: 'stale_version',
        message: 'All pending records are stale; the model must re-propose the batch.',
        extra: { staleRecords: stale.map((entry) => entry.recordId) },
      }
    }
    if (stale.length > 0) {
      return { ok: true, failedRecords: stale }
    }
    return { ok: true }
  }

  if (!tool.loadBeforeRecord) {
    return { ok: true }
  }
  const before = await tool.loadBeforeRecord(parseResult.data as never, handlerContext)
  if (!before) return { ok: true }
  const captured = action.recordVersion ?? null
  const current = before.recordVersion ?? null
  if (captured !== null && current !== captured) {
    return {
      ok: false,
      status: 412,
      code: 'stale_version',
      message: 'Record version changed since preview; re-propose the mutation.',
      extra: { recordId: before.recordId },
    }
  }
  return { ok: true }
}

function toHandlerContext(ctx: PendingActionAuthContext): McpToolContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    container: ctx.container as never,
    userFeatures: ctx.userFeatures,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

/**
 * Orchestrator: runs every guard in spec §9.4 order and returns the first
 * failure. Callers receive either `{ ok: true, failedRecords? }` — where a
 * non-empty `failedRecords` indicates a partial-stale batch that should
 * proceed with the non-stale subset — or `{ ok: false, status, code, ... }`
 * ready to serialize as an HTTP error envelope.
 */
export async function runPendingActionRechecks(
  input: PendingActionRecheckInput,
): Promise<PendingActionRecheckResult> {
  const { action, agent, tool, ctx, now, mutationPolicyOverride } = input

  const statusCheck = checkStatusAndExpiry(action, { now })
  if (!statusCheck.ok) return statusCheck

  if (isRawToolPendingAction(action)) {
    return runRawToolRechecks(input)
  }

  const agentCheck = checkAgentAndFeatures(agent, ctx)
  if (!agentCheck.ok) return agentCheck

  const whitelistCheck = checkToolWhitelist(agent!, tool, action, {
    mutationPolicyOverride: mutationPolicyOverride ?? null,
  })
  if (!whitelistCheck.ok) return whitelistCheck

  const attachmentCheck = await checkAttachmentScope(action, ctx)
  if (!attachmentCheck.ok) return attachmentCheck

  const versionCheck = await checkRecordVersion(action, tool!, ctx)
  return versionCheck
}

async function runRawToolRechecks(
  input: PendingActionRecheckInput,
): Promise<PendingActionRecheckResult> {
  const { action, tool, ctx, now } = input
  const exposureConfig = input.exposureConfig ?? resolveMcpExposureConfig(process.env, {})

  const exposureCheck = checkRawToolExposure(tool, action, exposureConfig)
  if (!exposureCheck.ok) return exposureCheck

  const approverCheck = checkApproverToolFeatures(tool!, ctx)
  if (!approverCheck.ok) return approverCheck

  const requesterCheck = await checkRawToolRequester(action, tool!, ctx, { now })
  if (!requesterCheck.ok) return requesterCheck

  const attachmentCheck = await checkAttachmentScope(action, ctx)
  if (!attachmentCheck.ok) return attachmentCheck

  return checkRecordVersion(action, tool!, ctx)
}

/**
 * Test-only helper shadowed here to let the route unit tests assert the
 * exhaustive set of codes without importing each guard individually.
 */
export const PENDING_ACTION_RECHECK_CODES: ReadonlyArray<PendingActionRecheckCode> = [
  'invalid_status',
  'expired',
  'agent_unknown',
  'agent_features_denied',
  'tool_not_whitelisted',
  'read_only_agent',
  'attachment_cross_tenant',
  'stale_version',
  'schema_drift',
  'tool_not_exposed',
  'approver_features_denied',
  'requester_revoked',
  'requester_features_denied',
]

export function isPendingActionRecheckCode(
  value: unknown,
): value is PendingActionRecheckCode {
  return typeof value === 'string' && (PENDING_ACTION_RECHECK_CODES as readonly string[]).includes(value)
}

export type { AiPendingActionFailedRecord } from './pending-action-types'

export type PendingActionRecheckStatus = AiPendingActionStatus
