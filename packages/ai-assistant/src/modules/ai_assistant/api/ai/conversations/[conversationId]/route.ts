import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  aiChatConversationTranscriptQuerySchema,
  aiChatConversationUpdateSchema,
} from '../../../../data/validators'
import { hasRequiredFeatures } from '../../../../lib/auth'
import {
  createConversationStorage,
  serializeAiChatConversation,
  serializeAiChatMessage,
} from '../../../../lib/conversation-storage'

const REQUIRED_FEATURE = 'ai_assistant.view'
const MANAGE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.manage'

const conversationIdParamSchema = z.object({
  conversationId: z
    .string()
    .trim()
    .min(1, 'conversationId must be a non-empty string')
    .max(128, 'conversationId exceeds the maximum length of 128 characters'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Per-conversation AI chat operations',
  methods: {
    GET: {
      operationId: 'aiAssistantGetConversation',
      summary: 'Fetch a conversation summary and recent transcript.',
      description:
        'Returns `{ conversation, messages, nextCursor }` for the supplied `conversationId`. ' +
        'View-only callers can load only their own conversations. Callers with ' +
        '`ai_assistant.conversations.manage` can load conversations across users in the same ' +
        'tenant/organization. Messages are ordered ascending by `createdAt`. The `before` cursor ' +
        'returns the next older page when paging back through long transcripts.',
      responses: [
        {
          status: 200,
          description: 'Conversation transcript page for the authenticated owner.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid path or query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
        { status: 404, description: 'No conversation accessible to the caller.' },
      ],
    },
    PATCH: {
      operationId: 'aiAssistantUpdateConversation',
      summary: 'Update an existing conversation.',
      description:
        'Accepts a partial body containing any of `title`, `status`, `pageContext`. Setting ' +
        '`status` to `closed` archives the conversation while keeping its transcript intact. ' +
        'View-only callers can update only their own conversations; conversation managers can ' +
        'update conversations in the same tenant/organization.',
      responses: [
        {
          status: 200,
          description: 'Updated conversation summary.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request body.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
        { status: 404, description: 'No conversation accessible to the caller.' },
      ],
    },
    DELETE: {
      operationId: 'aiAssistantDeleteConversation',
      summary: 'Soft-delete a conversation and its messages.',
      description:
        'View-only callers can delete only their own conversations. Callers with ' +
        '`ai_assistant.conversations.manage` can delete conversations in the same tenant/organization. ' +
        'Marks the conversation row and every undeleted message row with a `deleted_at` timestamp ' +
        'in one transaction. The transcript remains in the database for audit/restore until a future ' +
        'retention worker hard-deletes it.',
      responses: [
        {
          status: 200,
          description: 'Soft-delete acknowledgment.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
        { status: 404, description: 'No conversation accessible to the caller.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
  PATCH: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

interface RouteContext {
  params: Promise<{ conversationId: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

async function resolveCallerContext(req: NextRequest, context: RouteContext): Promise<
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'missing-tenant' }
  | { kind: 'invalid-id'; issues: unknown }
  | {
      kind: 'ok'
      tenantId: string
      organizationId: string | null
      userId: string
      conversationId: string
      canManageConversations: boolean
    }
> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return { kind: 'unauthorized' }
  const rawParams = await context.params
  const parseResult = conversationIdParamSchema.safeParse(rawParams)
  if (!parseResult.success) {
    return { kind: 'invalid-id', issues: parseResult.error.issues }
  }
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
  if (!auth.tenantId) return { kind: 'missing-tenant' }
  return {
    kind: 'ok',
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    conversationId: parseResult.data.conversationId,
    canManageConversations,
  }
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const callerCtx = await resolveCallerContext(req, context)
  if (callerCtx.kind === 'unauthorized') return jsonError(401, 'Unauthorized', 'unauthenticated')
  if (callerCtx.kind === 'invalid-id') {
    return jsonError(400, 'Invalid conversation id.', 'validation_error', {
      issues: callerCtx.issues,
    })
  }
  if (callerCtx.kind === 'forbidden') {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  if (callerCtx.kind === 'missing-tenant') {
    return jsonError(404, 'Conversation not found.', 'conversation_not_found')
  }

  const url = new URL(req.url)
  const queryResult = aiChatConversationTranscriptQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    before: url.searchParams.get('before') ?? undefined,
  })
  if (!queryResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    const transcript = await repo.getTranscript(
      callerCtx.conversationId,
      {
        tenantId: callerCtx.tenantId,
        organizationId: callerCtx.organizationId,
        userId: callerCtx.userId,
        canManageConversations: callerCtx.canManageConversations,
      },
      {
        limit: queryResult.data.limit,
        before: queryResult.data.before ?? null,
      },
    )
    if (!transcript) {
      return jsonError(404, 'Conversation not found.', 'conversation_not_found')
    }
    const participantCount = await repo.getParticipantCount(
      callerCtx.tenantId,
      callerCtx.organizationId,
      callerCtx.conversationId,
    )
    return NextResponse.json({
      conversation: serializeAiChatConversation(transcript.conversation, {
        callerUserId: callerCtx.userId,
        participantCount,
      }),
      messages: transcript.messages.map(serializeAiChatMessage),
      nextCursor: transcript.nextCursor,
    })
  } catch (error) {
    console.error('[AI Conversation GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to load conversation.',
      'internal_error',
    )
  }
}

export async function PATCH(req: NextRequest, context: RouteContext): Promise<Response> {
  const callerCtx = await resolveCallerContext(req, context)
  if (callerCtx.kind === 'unauthorized') return jsonError(401, 'Unauthorized', 'unauthenticated')
  if (callerCtx.kind === 'invalid-id') {
    return jsonError(400, 'Invalid conversation id.', 'validation_error', {
      issues: callerCtx.issues,
    })
  }
  if (callerCtx.kind === 'forbidden') {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  if (callerCtx.kind === 'missing-tenant') {
    return jsonError(404, 'Conversation not found.', 'conversation_not_found')
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }
  const parseResult = aiChatConversationUpdateSchema.safeParse(rawBody)
  if (!parseResult.success) {
    return jsonError(400, 'Invalid conversation patch.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    const row = await repo.update(
      callerCtx.conversationId,
      parseResult.data,
      {
        tenantId: callerCtx.tenantId,
        organizationId: callerCtx.organizationId,
        userId: callerCtx.userId,
        canManageConversations: callerCtx.canManageConversations,
      },
    )
    return NextResponse.json(serializeAiChatConversation(row))
  } catch (error) {
    if (error instanceof Error && error.name === 'AiChatConversationAccessError') {
      return jsonError(404, 'Conversation not found.', 'conversation_not_found')
    }
    console.error('[AI Conversation PATCH] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to update conversation.',
      'internal_error',
    )
  }
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<Response> {
  const callerCtx = await resolveCallerContext(req, context)
  if (callerCtx.kind === 'unauthorized') return jsonError(401, 'Unauthorized', 'unauthenticated')
  if (callerCtx.kind === 'invalid-id') {
    return jsonError(400, 'Invalid conversation id.', 'validation_error', {
      issues: callerCtx.issues,
    })
  }
  if (callerCtx.kind === 'forbidden') {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  if (callerCtx.kind === 'missing-tenant') {
    return jsonError(404, 'Conversation not found.', 'conversation_not_found')
  }

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    await repo.softDelete(callerCtx.conversationId, {
      tenantId: callerCtx.tenantId,
      organizationId: callerCtx.organizationId,
      userId: callerCtx.userId,
      canManageConversations: callerCtx.canManageConversations,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'AiChatConversationAccessError') {
      return jsonError(404, 'Conversation not found.', 'conversation_not_found')
    }
    console.error('[AI Conversation DELETE] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to delete conversation.',
      'internal_error',
    )
  }
}
