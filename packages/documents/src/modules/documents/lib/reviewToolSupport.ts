/**
 * Shared plumbing for the Documents AI tools (`ai-tools.ts`).
 *
 * Tools are plain objects discovered by the ai-assistant generator, so this
 * module re-declares the slice of the tool contract Documents needs instead of
 * importing `@open-mercato/ai-assistant` at runtime.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import { attachTrustedAuthContext, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { loadDocumentContent } from './contentService'
import { hasTier, loadScopedDocument, resolveLoadedDocumentUserAccess, type DocumentTier } from './permissions'
import { extractReviewBlocksFromYjsState, type ReviewBlock } from './reviewContent'

export type DocumentsToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: {
    resolve: <T = unknown>(name: string) => T
  }
  userFeatures: string[]
  isSuperAdmin: boolean
  expectedRecordVersions?: Readonly<Record<string, string>>
}

export type DocumentsToolPreview = {
  recordId: string
  entityType: string
  recordVersion: string | null
  before: Record<string, unknown>
  after?: Record<string, unknown>
  display?: {
    fieldLabels?: Record<string, string>
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }
}

export type DocumentsAiToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures: string[]
  tags?: string[]
  isMutation: boolean
  loadBeforeRecord?: (input: TInput, ctx: DocumentsToolContext) => Promise<DocumentsToolPreview | null>
  handler(input: TInput, ctx: DocumentsToolContext): Promise<TOutput>
}

export type ToolScope = { tenantId: string; organizationId: string; userId: string }

export function requireToolScope(ctx: DocumentsToolContext): ToolScope {
  if (!ctx.tenantId || !ctx.organizationId || !ctx.userId) {
    throw new Error('[internal] Documents review tools require tenant, organization and user context')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: ctx.userId }
}

export function resolveToolEntityManager(ctx: DocumentsToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

export async function loadReviewBlocks(
  em: EntityManager,
  documentId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<ReviewBlock[]> {
  const content = await loadDocumentContent(em, documentId, scope)
  const blocks = extractReviewBlocksFromYjsState(content?.yjsState ?? null)
  if (blocks.length > 0) return blocks
  const text = (content?.contentText ?? '').replace(/\s+/g, ' ').trim()
  return text ? [{ index: 0, kind: 'paragraph', sectionLabel: '', text }] : []
}

export async function loadDocumentWithTier(
  em: EntityManager,
  ctx: DocumentsToolContext,
  scope: ToolScope,
  documentId: string,
  minimumTier: DocumentTier,
) {
  const document = await loadScopedDocument(em, documentId, scope)
  if (!document) return null
  const tier = await resolveLoadedDocumentUserAccess(em, document, scope, scope.userId, ctx.container)
  return hasTier(tier, minimumTier) ? document : null
}

export type DocumentsRouteHandler = (
  request: Request,
  context: { params: Record<string, string> },
) => Promise<Response>

export type DocumentsRouteCall<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: string }

const SYNTHETIC_ORIGIN = 'http://internal.local'

function buildToolAuth(ctx: DocumentsToolContext, scope: ToolScope): AuthContext {
  const apiKeyId = scope.userId.startsWith('api_key:') ? scope.userId.slice('api_key:'.length) : undefined
  return {
    sub: scope.userId,
    userId: scope.userId,
    tenantId: scope.tenantId,
    orgId: scope.organizationId,
    roles: [],
    isSuperAdmin: ctx.isSuperAdmin,
    ...(apiKeyId ? { keyId: apiKeyId } : {}),
  }
}

/**
 * Runs one of this module's own API route handlers in-process for the tool's
 * principal, so a tool reuses the route's tier checks, archived guard,
 * optimistic lock, mutation guards and command execution instead of
 * re-implementing them. The principal comes from the AI runtime's gated auth
 * resolution (the same invariant `createAiApiOperationRunner` relies on); the
 * route still reloads features and organization access from RBAC.
 */
export async function callDocumentsRoute<T>(
  ctx: DocumentsToolContext,
  handler: DocumentsRouteHandler,
  input: {
    method: 'GET' | 'POST'
    path: string
    params: Record<string, string>
    query?: Record<string, string | number | undefined>
    body?: Record<string, unknown>
  },
): Promise<DocumentsRouteCall<T>> {
  const scope = requireToolScope(ctx)
  const url = new URL(`${SYNTHETIC_ORIGIN}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const headers = new Headers()
  const init: RequestInit = { method: input.method, headers }
  if (input.body !== undefined && input.method !== 'GET') {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(input.body)
  }
  const request = attachTrustedAuthContext(new Request(url, init), {
    auth: buildToolAuth(ctx, scope),
    status: 'authenticated',
  })
  const response = await handler(request, { params: input.params })
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  if (response.ok) return { ok: true, status: response.status, body: parsed as T }
  const error = parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
    ? (parsed as { error: string }).error
    : `Request failed with status ${response.status}`
  return { ok: false, status: response.status, error }
}
