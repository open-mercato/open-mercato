import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import {
  createConversationStorage,
  AiChatConversationAccessError,
  AiChatConversationDuplicateParticipantError,
} from '../../../../../lib/conversation-storage'
import { emitAiAssistantEvent } from '../../../../../events'

const REQUIRED_FEATURE = 'ai_assistant.view'
const MANAGE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.manage'
const SHARE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.share'

const conversationIdParamSchema = z.object({
  conversationId: z
    .string()
    .trim()
    .min(1, 'conversationId must be a non-empty string')
    .max(128, 'conversationId exceeds the maximum length of 128 characters'),
})

const addParticipantBodySchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  role: z.enum(['viewer']).default('viewer'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Manage conversation participants',
  methods: {
    GET: {
      operationId: 'aiAssistantListConversationParticipants',
      summary: 'List active participants of a conversation.',
      description:
        'Returns the list of active (non-revoked) participants for the conversation. ' +
        'Only the conversation owner or a caller with `ai_assistant.conversations.manage` can call this endpoint.',
      responses: [
        {
          status: 200,
          description: 'List of active participants.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks required features.' },
        { status: 404, description: 'Conversation not found or not accessible.' },
      ],
    },
    POST: {
      operationId: 'aiAssistantAddConversationParticipant',
      summary: 'Add a participant to a conversation.',
      description:
        'Grants a named user read access to the conversation. Requires `ai_assistant.conversations.share`. ' +
        'Only the conversation owner may add participants. If the user was previously revoked, the soft-deleted row is restored.',
      responses: [
        {
          status: 201,
          description: 'Participant added; conversation visibility updated to "shared".',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request body.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks required feature or is not the owner.' },
        { status: 404, description: 'Conversation not found.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
  POST: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
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
      canShare: boolean
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
  if (!auth.tenantId) return { kind: 'missing-tenant' }
  return {
    kind: 'ok',
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    conversationId: parseResult.data.conversationId,
    canManageConversations: hasRequiredFeatures(
      [MANAGE_CONVERSATIONS_FEATURE],
      acl.features,
      acl.isSuperAdmin,
      rbacService,
    ),
    canShare: hasRequiredFeatures(
      [SHARE_CONVERSATIONS_FEATURE],
      acl.features,
      acl.isSuperAdmin,
      rbacService,
    ),
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

  try {
    const container = await createRequestContainer()
    const repo = createConversationStorage(container)
    const repoCtx = {
      tenantId: callerCtx.tenantId,
      organizationId: callerCtx.organizationId,
      userId: callerCtx.userId,
      canManageConversations: callerCtx.canManageConversations,
    }
    const conversation = await repo.getById(callerCtx.conversationId, repoCtx)
    if (!conversation) {
      return jsonError(404, 'Conversation not found.', 'conversation_not_found')
    }
    const participants = await repo.listParticipants(callerCtx.conversationId, repoCtx)
    return NextResponse.json({
      ownerUserId: conversation.ownerUserId,
      participants: participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        lastReadAt: p.lastReadAt ? p.lastReadAt.toISOString() : null,
        addedAt: p.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    if (err instanceof AiChatConversationAccessError) {
      return jsonError(403, 'Access denied.', 'forbidden')
    }
    return jsonError(500, 'Internal server error.', 'internal_error')
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
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
  if (!callerCtx.canShare) {
    return jsonError(
      403,
      `Caller lacks required feature "${SHARE_CONVERSATIONS_FEATURE}".`,
      'forbidden',
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Invalid JSON body.', 'invalid_body')
  }
  const parseResult = addParticipantBodySchema.safeParse(body)
  if (!parseResult.success) {
    return jsonError(400, 'Invalid request body.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }

  const targetUserId = parseResult.data.userId
  if (targetUserId === callerCtx.userId) {
    return jsonError(400, 'Cannot share a conversation with yourself.', 'self_share_not_allowed')
  }

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const targetUserFilter: FilterQuery<User> = {
      id: targetUserId,
      tenantId: callerCtx.tenantId,
      deletedAt: null,
      ...(callerCtx.organizationId ? { organizationId: callerCtx.organizationId } : {}),
    }
    const targetUser = await findOneWithDecryption<User>(
      em,
      User,
      targetUserFilter,
      {},
      { tenantId: callerCtx.tenantId, organizationId: callerCtx.organizationId },
    )
    if (!targetUser) {
      return jsonError(
        400,
        'Target user must be a staff user in the same tenant and organization.',
        'user_not_found',
      )
    }

    const repo = createConversationStorage(container)
    const participant = await repo.addParticipant(
      callerCtx.conversationId,
      targetUserId,
      parseResult.data.role,
      {
        tenantId: callerCtx.tenantId,
        organizationId: callerCtx.organizationId,
        userId: callerCtx.userId,
        canManageConversations: callerCtx.canManageConversations,
      },
    )
    try {
      await emitAiAssistantEvent(
        'ai_assistant.conversation.shared',
        {
          conversationId: callerCtx.conversationId,
          tenantId: callerCtx.tenantId,
          organizationId: callerCtx.organizationId,
          ownerUserId: callerCtx.userId,
          participantUserId: participant.userId,
          role: participant.role,
        },
        { persistent: false },
      )
    } catch {
      // non-fatal
    }
    return NextResponse.json(
      {
        participant: {
          userId: participant.userId,
          role: participant.role,
          lastReadAt: participant.lastReadAt ? participant.lastReadAt.toISOString() : null,
          addedAt: participant.createdAt.toISOString(),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof AiChatConversationDuplicateParticipantError) {
      return jsonError(409, err.message, 'duplicate_participant')
    }
    if (err instanceof AiChatConversationAccessError) {
      return jsonError(404, 'Conversation not found.', 'conversation_not_found')
    }
    if (err instanceof Error && err.message.toLowerCase().includes('owner')) {
      return jsonError(403, err.message, 'forbidden')
    }
    return jsonError(500, 'Internal server error.', 'internal_error')
  }
}
