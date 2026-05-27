import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  aiChatConversationCreateSchema,
  aiChatConversationListQuerySchema,
} from '../../../data/validators'
import { hasRequiredFeatures } from '../../../lib/auth'
import {
  createConversationStorage,
  serializeAiChatConversation,
} from '../../../lib/conversation-storage'

const REQUIRED_FEATURE = 'ai_assistant.view'
const MANAGE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.manage'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Server-side AI chat conversations',
  methods: {
    GET: {
      operationId: 'aiAssistantListConversations',
      summary: 'List AI chat conversations visible to the caller.',
      description:
        'Returns `{ items, nextCursor }` for the authenticated caller, ordered by `lastMessageAt` ' +
        'descending. View-only callers receive only their own conversations. Callers with ' +
        '`ai_assistant.conversations.manage` may list conversations across users in the same ' +
        'tenant/organization. The ' +
        '`agent` and `status` filters are optional; `cursor` is the ISO timestamp returned by a ' +
        'previous response.',
      responses: [
        {
          status: 200,
          description: 'Caller-owned conversation summaries.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
      ],
    },
    POST: {
      operationId: 'aiAssistantCreateConversation',
      summary: 'Idempotently create a new AI chat conversation.',
      description:
        'If a non-deleted conversation already exists with the supplied `conversationId` for the ' +
        'authenticated caller in this tenant/org, returns the existing summary. Otherwise creates a ' +
        'fresh row and writes the owner-participant row in the same transaction.',
      responses: [
        {
          status: 200,
          description: 'Existing conversation (idempotent path).',
          mediaType: 'application/json',
        },
        {
          status: 201,
          description: 'Newly created conversation.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request body.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
  POST: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

async function loadCallerContext(req: NextRequest): Promise<
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'missing-tenant' }
  | {
      kind: 'ok'
      tenantId: string
      organizationId: string | null
      userId: string
      canManageConversations: boolean
    }
> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return { kind: 'unauthorized' }
  const container = await createRequestContainer()
  const rbacService = container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
    return { kind: 'forbidden' }
  }
  const canManageConversations = hasRequiredFeatures(
    [MANAGE_CONVERSATIONS_FEATURE],
    acl.features,
    acl.isSuperAdmin,
    rbacService,
  )
  if (!auth.tenantId) {
    return { kind: 'missing-tenant' }
  }
  return {
    kind: 'ok',
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    canManageConversations,
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const callerCtx = await loadCallerContext(req)
  if (callerCtx.kind === 'unauthorized') return jsonError(401, 'Unauthorized', 'unauthenticated')
  if (callerCtx.kind === 'forbidden') {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  if (callerCtx.kind === 'missing-tenant') {
    return NextResponse.json({ items: [], nextCursor: null })
  }

  const url = new URL(req.url)
  const parseResult = aiChatConversationListQuerySchema.safeParse({
    agent: url.searchParams.get('agent') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  })
  if (!parseResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    const result = await repo.list(
      {
        tenantId: callerCtx.tenantId,
        organizationId: callerCtx.organizationId,
        userId: callerCtx.userId,
        canManageConversations: callerCtx.canManageConversations,
      },
      {
        agentId: parseResult.data.agent ?? null,
        status: parseResult.data.status ?? null,
        limit: parseResult.data.limit,
        cursor: parseResult.data.cursor ?? null,
      },
    )
    return NextResponse.json({
      items: result.items.map((row) => serializeAiChatConversation(row)),
      nextCursor: result.nextCursor,
    })
  } catch (error) {
    console.error('[AI Conversations GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to list conversations.',
      'internal_error',
    )
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const callerCtx = await loadCallerContext(req)
  if (callerCtx.kind === 'unauthorized') return jsonError(401, 'Unauthorized', 'unauthenticated')
  if (callerCtx.kind === 'forbidden') {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  if (callerCtx.kind === 'missing-tenant') {
    return jsonError(400, 'Caller is not bound to a tenant.', 'tenant_required')
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }

  const parseResult = aiChatConversationCreateSchema.safeParse(rawBody)
  if (!parseResult.success) {
    return jsonError(400, 'Invalid conversation payload.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    const ctx = {
      tenantId: callerCtx.tenantId,
      organizationId: callerCtx.organizationId,
      userId: callerCtx.userId,
      canManageConversations: false,
    }
    const beforeRow = parseResult.data.conversationId
      ? await repo.getById(parseResult.data.conversationId, ctx)
      : null
    const row = await repo.createOrGet(
      {
        conversationId: parseResult.data.conversationId,
        agentId: parseResult.data.agentId,
        title: parseResult.data.title ?? null,
        pageContext: parseResult.data.pageContext ?? null,
      },
      ctx,
    )
    const status = beforeRow ? 200 : 201
    return NextResponse.json(serializeAiChatConversation(row), { status })
  } catch (error) {
    if (error instanceof Error && error.name === 'AiChatConversationOrgNotFoundError') {
      return jsonError(400, error.message, 'organization_not_found')
    }
    if (error instanceof Error && error.name === 'AiChatConversationAccessError') {
      return jsonError(404, error.message, 'conversation_not_found')
    }
    console.error('[AI Conversations POST] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to create conversation.',
      'internal_error',
    )
  }
}
