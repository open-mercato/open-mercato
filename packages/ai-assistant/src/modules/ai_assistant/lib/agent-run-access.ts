import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { NextResponse } from 'next/server'
import { findAndCountWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  AiAgentRun,
  AiAgentRunStep,
  AiAgentRunToolCall,
  AiChatConversation,
  AiChatConversationParticipant,
} from '../data/entities'
import type { AiAgentRunListQuery } from '../data/validators'
import { hasRequiredFeatures } from './auth'

export const AI_AGENT_RUNS_VIEW_FEATURE = 'ai_assistant.runs.view'

export const AI_AGENT_RUNS_VIEW_ALL_FEATURE = 'ai_assistant.runs.view_all'

export type AiAgentRunAccessContext = {
  tenantId: string
  organizationId: string | null
  userId: string
  canViewAll: boolean
}

export type AiAgentRunCallerResolution =
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'missing-tenant' }
  | { kind: 'ok'; ctx: AiAgentRunAccessContext; container: AwilixContainer }

/**
 * Authenticates the caller and checks `ai_assistant.runs.view`; `runs.view_all`
 * widens the scope to every run of the caller's tenant and organization.
 * Tenant and organization always come from the session, never the request.
 */
export async function resolveAgentRunCaller(req: Request): Promise<AiAgentRunCallerResolution> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return { kind: 'unauthorized' }
  const container = await createRequestContainer()
  const rbacService = container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!hasRequiredFeatures([AI_AGENT_RUNS_VIEW_FEATURE], acl.features, acl.isSuperAdmin)) {
    return { kind: 'forbidden' }
  }
  if (!auth.tenantId) return { kind: 'missing-tenant' }
  return {
    kind: 'ok',
    container,
    ctx: {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      canViewAll: hasRequiredFeatures([AI_AGENT_RUNS_VIEW_ALL_FEATURE], acl.features, acl.isSuperAdmin),
    },
  }
}

export function agentRunJsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export function agentRunAuthError(
  resolution: Extract<AiAgentRunCallerResolution, { kind: 'unauthorized' | 'forbidden' }>,
): NextResponse {
  if (resolution.kind === 'unauthorized') return agentRunJsonError(401, 'Unauthorized', 'unauthenticated')
  return agentRunJsonError(
    403,
    `Caller lacks required feature "${AI_AGENT_RUNS_VIEW_FEATURE}".`,
    'forbidden',
  )
}

function decryptionScope(ctx: AiAgentRunAccessContext) {
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

/**
 * Conversation ids whose runs the caller may read: conversations the caller
 * owns, conversations with an active participant row for the caller, and
 * organization-visible conversations — all inside the caller's tenant/org.
 */
export async function listReadableConversationIds(
  em: EntityManager,
  ctx: AiAgentRunAccessContext,
  restrictTo?: string,
): Promise<string[]> {
  const participantRows = await findWithDecryption<AiChatConversationParticipant>(
    em,
    AiChatConversationParticipant,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      deletedAt: null,
      ...(restrictTo ? { conversationId: restrictTo } : {}),
    } as FilterQuery<AiChatConversationParticipant>,
    {},
    decryptionScope(ctx),
  )
  const participantIds = participantRows.map((row) => row.conversationId)
  const visibilityBranches: FilterQuery<AiChatConversation>[] = [
    { ownerUserId: ctx.userId },
    { visibility: 'organization' },
  ]
  if (participantIds.length > 0) {
    visibilityBranches.push({ conversationId: { $in: participantIds } })
  }
  const conversations = await findWithDecryption<AiChatConversation>(
    em,
    AiChatConversation,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(restrictTo ? { conversationId: restrictTo } : {}),
      $or: visibilityBranches,
    } as FilterQuery<AiChatConversation>,
    {},
    decryptionScope(ctx),
  )
  return Array.from(new Set(conversations.map((row) => row.conversationId)))
}

export async function canReadConversationRuns(
  em: EntityManager,
  ctx: AiAgentRunAccessContext,
  conversationId: string,
): Promise<boolean> {
  if (!ctx.canViewAll) {
    const ids = await listReadableConversationIds(em, ctx, conversationId)
    return ids.includes(conversationId)
  }
  const conversations = await findWithDecryption<AiChatConversation>(
    em,
    AiChatConversation,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      conversationId,
      deletedAt: null,
    } as FilterQuery<AiChatConversation>,
    { limit: 1 },
    decryptionScope(ctx),
  )
  return conversations.length > 0
}

/**
 * Scope filter for `ai_agent_runs`: tenant + organization + not deleted, and —
 * without `runs.view_all` — only the caller's own runs or runs of readable
 * conversations.
 */
export async function buildAgentRunScopeFilter(
  em: EntityManager,
  ctx: AiAgentRunAccessContext,
): Promise<FilterQuery<AiAgentRun>> {
  const base = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  }
  if (ctx.canViewAll) return base as FilterQuery<AiAgentRun>
  const conversationIds = await listReadableConversationIds(em, ctx)
  if (conversationIds.length === 0) {
    return { ...base, userId: ctx.userId } as FilterQuery<AiAgentRun>
  }
  return {
    ...base,
    $or: [{ userId: ctx.userId }, { conversationId: { $in: conversationIds } }],
  } as FilterQuery<AiAgentRun>
}

export async function canReadAgentRun(
  em: EntityManager,
  ctx: AiAgentRunAccessContext,
  run: Pick<AiAgentRun, 'tenantId' | 'organizationId' | 'userId' | 'conversationId'>,
): Promise<boolean> {
  if (run.tenantId !== ctx.tenantId) return false
  if ((run.organizationId ?? null) !== ctx.organizationId) return false
  if (ctx.canViewAll) return true
  if (run.userId && run.userId === ctx.userId) return true
  if (!run.conversationId) return false
  return canReadConversationRuns(em, ctx, run.conversationId)
}

export type AiAgentRunPageOptions = {
  filters?: Omit<AiAgentRunListQuery, 'page' | 'pageSize'>
  page: number
  pageSize: number
  order: 'asc' | 'desc'
}

export type AiAgentRunPage = {
  items: AiAgentRunListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function emptyAgentRunPage(page: number, pageSize: number): AiAgentRunPage {
  return { items: [], total: 0, page, pageSize, totalPages: 0 }
}

/** One page of runs inside the caller's scope, newest first unless `order` is `asc`. */
export async function listAgentRunPage(
  em: EntityManager,
  ctx: AiAgentRunAccessContext,
  options: AiAgentRunPageOptions,
): Promise<AiAgentRunPage> {
  const scope = await buildAgentRunScopeFilter(em, ctx)
  const filters = options.filters ?? {}
  const where: Record<string, unknown> = { ...(scope as Record<string, unknown>) }
  if (filters.agentId) where.agentId = filters.agentId
  if (filters.channel) where.channel = filters.channel
  if (filters.status) where.status = filters.status
  if (filters.userId) where.userId = filters.userId
  if (filters.conversationId) where.conversationId = filters.conversationId
  if (filters.from || filters.to) {
    where.startedAt = {
      ...(filters.from ? { $gte: new Date(filters.from) } : {}),
      ...(filters.to ? { $lte: new Date(filters.to) } : {}),
    }
  }
  const [rows, total] = await findAndCountWithDecryption<AiAgentRun>(
    em,
    AiAgentRun,
    where as FilterQuery<AiAgentRun>,
    {
      orderBy: [{ startedAt: options.order }, { id: options.order }],
      limit: options.pageSize,
      offset: (options.page - 1) * options.pageSize,
    },
    decryptionScope(ctx),
  )
  return {
    items: rows.map(serializeAgentRunListItem),
    total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.ceil(total / options.pageSize),
  }
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export type AiAgentRunListItem = {
  id: string
  agentId: string
  agentVersion: string | null
  executionMode: AiAgentRun['executionMode']
  channel: AiAgentRun['channel']
  status: AiAgentRun['status']
  modelId: string
  providerId: string
  inputTokens: number
  outputTokens: number
  stepCount: number
  toolCallCount: number
  durationMs: number
  conversationId: string | null
  userId: string | null
  captureLevel: AiAgentRun['captureLevel']
  startedAt: string
  completedAt: string
  updatedAt: string
}

/** List rows carry metadata only — never input/output text, prompts, citations or error text. */
export function serializeAgentRunListItem(run: AiAgentRun): AiAgentRunListItem {
  return {
    id: run.id,
    agentId: run.agentId,
    agentVersion: run.agentVersion ?? null,
    executionMode: run.executionMode,
    channel: run.channel,
    status: run.status,
    modelId: run.modelId,
    providerId: run.providerId,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    stepCount: run.stepCount,
    toolCallCount: run.toolCallCount,
    durationMs: run.durationMs,
    conversationId: run.conversationId ?? null,
    userId: run.userId ?? null,
    captureLevel: run.captureLevel,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }
}

export function serializeAgentRunDetail(run: AiAgentRun) {
  return {
    ...serializeAgentRunListItem(run),
    moduleId: run.moduleId,
    agentDefinitionHash: run.agentDefinitionHash,
    promptOverrideId: run.promptOverrideId ?? null,
    promptOverrideVersion: run.promptOverrideVersion ?? null,
    turnId: run.turnId,
    correlationId: run.correlationId ?? null,
    apiKeyId: run.apiKeyId ?? null,
    baseUrlHost: run.baseUrlHost ?? null,
    modelParams: run.modelParams,
    effectiveMutationPolicy: run.effectiveMutationPolicy,
    toolNames: run.toolNames,
    stopReason: run.stopReason ?? null,
    finishReason: run.finishReason ?? null,
    cachedInputTokens: run.cachedInputTokens ?? null,
    reasoningTokens: run.reasoningTokens ?? null,
    inputText: run.inputText ?? null,
    outputText: run.outputText ?? null,
    contentTruncated: run.contentTruncated,
    systemPromptHash: run.systemPromptHash,
    systemPrompt: run.systemPrompt ?? null,
    citations: run.citations ?? null,
    error:
      run.errorCode || run.errorMessage
        ? { code: run.errorCode ?? null, message: run.errorMessage ?? null }
        : null,
    createdAt: run.createdAt.toISOString(),
  }
}

export function serializeAgentRunStep(step: AiAgentRunStep) {
  return {
    id: step.id,
    stepIndex: step.stepIndex,
    modelId: step.modelId,
    finishReason: step.finishReason,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    text: step.text ?? null,
    textTruncated: step.textTruncated,
    endedAt: toIso(step.endedAt),
    durationMs: step.durationMs,
    updatedAt: step.updatedAt.toISOString(),
  }
}

export function serializeAgentRunToolCall(toolCall: AiAgentRunToolCall) {
  return {
    id: toolCall.id,
    stepIndex: toolCall.stepIndex,
    callIndex: toolCall.callIndex,
    toolCallId: toolCall.toolCallId ?? null,
    toolName: toolCall.toolName,
    isMutation: toolCall.isMutation,
    pendingActionId: toolCall.pendingActionId ?? null,
    argKeys: toolCall.argKeys,
    args: toolCall.args ?? null,
    result: toolCall.result ?? null,
    argsTruncated: toolCall.argsTruncated,
    resultTruncated: toolCall.resultTruncated,
    resultBytes: toolCall.resultBytes,
    error:
      toolCall.errorCode || toolCall.errorMessage
        ? { code: toolCall.errorCode ?? null, message: toolCall.errorMessage ?? null }
        : null,
    durationMs: toolCall.durationMs,
    updatedAt: toolCall.updatedAt.toISOString(),
  }
}
