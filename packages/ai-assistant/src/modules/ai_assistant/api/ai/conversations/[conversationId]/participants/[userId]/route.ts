import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { hasRequiredFeatures } from '../../../../../../lib/auth'
import {
  AiChatConversationAccessError,
  AiChatParticipantNotFoundError,
  createConversationStorage,
} from '../../../../../../lib/conversation-storage'
import { emitAiAssistantEvent } from '../../../../../../events'

const REQUIRED_FEATURE = 'ai_assistant.view'
const MANAGE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.manage'
const SHARE_CONVERSATIONS_FEATURE = 'ai_assistant.conversations.share'

const participantParamsSchema = z.object({
  conversationId: z
    .string()
    .trim()
    .min(1, 'conversationId must be a non-empty string')
    .max(128, 'conversationId exceeds the maximum length of 128 characters'),
  userId: z.string().uuid('userId must be a valid UUID'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Revoke a conversation participant',
  methods: {
    DELETE: {
      operationId: 'aiAssistantRevokeConversationParticipant',
      summary: 'Revoke a participant from a conversation (soft-delete).',
      description:
        'Soft-deletes the participant row. If no active non-owner participants remain, ' +
        'the conversation visibility is reset to "private". ' +
        'Only the conversation owner or a manager may revoke participants.',
      responses: [
        {
          status: 204,
          description: 'Participant revoked.',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid path parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks required features or is not the owner.' },
        { status: 404, description: 'Conversation not found.' },
      ],
    },
  },
}

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

interface RouteContext {
  params: Promise<{ conversationId: string; userId: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return jsonError(401, 'Unauthorized', 'unauthenticated')
  const rawParams = await context.params
  const parseResult = participantParamsSchema.safeParse(rawParams)
  if (!parseResult.success) {
    return jsonError(400, 'Invalid path parameters.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }
  if (!auth.tenantId) return jsonError(404, 'Conversation not found.', 'conversation_not_found')

  const container = await createRequestContainer()
  const rbacService = container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  const canShare = hasRequiredFeatures(
    [SHARE_CONVERSATIONS_FEATURE],
    acl.features,
    acl.isSuperAdmin,
    rbacService,
  )
  if (!canShare) {
    return jsonError(
      403,
      `Caller lacks required feature "${SHARE_CONVERSATIONS_FEATURE}".`,
      'forbidden',
    )
  }

  try {
    const repo = createConversationStorage(container)
    await repo.revokeParticipant(
      parseResult.data.conversationId,
      parseResult.data.userId,
      {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        canManageConversations: hasRequiredFeatures(
          [MANAGE_CONVERSATIONS_FEATURE],
          acl.features,
          acl.isSuperAdmin,
          rbacService,
        ),
      },
    )
    try {
      await emitAiAssistantEvent(
        'ai_assistant.conversation.unshared',
        {
          conversationId: parseResult.data.conversationId,
          tenantId: auth.tenantId,
          organizationId: auth.orgId ?? null,
          ownerUserId: auth.sub,
          participantUserId: parseResult.data.userId,
        },
        { persistent: false },
      )
    } catch {
      // non-fatal
    }
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof AiChatParticipantNotFoundError) {
      return jsonError(404, err.message || 'Participant not found or already revoked.', 'participant_not_found')
    }
    if (err instanceof AiChatConversationAccessError) {
      return jsonError(403, err.message || 'Access denied.', 'forbidden')
    }
    return jsonError(500, 'Internal server error.', 'internal_error')
  }
}
