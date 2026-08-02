import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { aiChatConversationImportSchema } from '../../../../data/validators'
import { hasRequiredFeatures } from '../../../../lib/auth'
import {
  createConversationStorage,
  serializeAiChatConversation,
} from '../../../../lib/conversation-storage'

const logger = createLogger('ai_assistant')

const REQUIRED_FEATURE = 'ai_assistant.view'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Lazily import a localStorage AI chat conversation',
  methods: {
    POST: {
      operationId: 'aiAssistantImportConversation',
      summary: 'Import a conversation that previously lived only in browser localStorage.',
      description:
        'Idempotent: messages with `clientMessageId` already present in the server transcript are ' +
        'skipped and counted in `skippedMessageCount`. New messages are appended with the original ' +
        '`clientMessageId` so subsequent retries continue to dedupe. Up to 100 messages per request. ' +
        'Attachment previews stored as `data:` URLs in the source localStorage record MUST NOT be ' +
        'forwarded to this endpoint; the UI strips them before upload.',
      responses: [
        {
          status: 200,
          description: 'Import result including imported/skipped counters.',
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

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return jsonError(401, 'Unauthorized', 'unauthenticated')

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }
  const parseResult = aiChatConversationImportSchema.safeParse(rawBody)
  if (!parseResult.success) {
    return jsonError(400, 'Invalid import payload.', 'validation_error', {
      issues: parseResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
      return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
    }
    if (!auth.tenantId) {
      return jsonError(400, 'Caller is not bound to a tenant.', 'tenant_required')
    }

    const repo = createConversationStorage(container)
    const result = await repo.importLocalConversation(
      {
        conversation: {
          conversationId: parseResult.data.conversation.conversationId,
          agentId: parseResult.data.conversation.agentId,
          title: parseResult.data.conversation.title ?? null,
          status: parseResult.data.conversation.status,
          pageContext: parseResult.data.conversation.pageContext ?? null,
        },
        messages: parseResult.data.messages,
      },
      {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
    )
    return NextResponse.json({
      conversation: serializeAiChatConversation(result.conversation),
      importedMessageCount: result.importedMessageCount,
      skippedMessageCount: result.skippedMessageCount,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AiChatConversationAccessError') {
      return jsonError(404, error.message, 'conversation_not_found')
    }
    logger.error('AI Conversation Import — Failure', { err: error })
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to import conversation.',
      'internal_error',
    )
  }
}
