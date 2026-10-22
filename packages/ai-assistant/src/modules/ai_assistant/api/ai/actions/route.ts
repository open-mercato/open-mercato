import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  AiPendingActionRepository,
} from '../../../data/repositories/AiPendingActionRepository'
import type { AiPendingAction } from '../../../data/entities'
import { aiPendingActionListQuerySchema } from '../../../data/validators'
import { hasRequiredFeatures } from '../../../lib/auth'
import {
  serializePendingActionForClient,
  type SerializedPendingAction,
} from '../../../lib/pending-action-client'
import {
  AI_PENDING_ACTION_APPROVE_FEATURE,
  type AiPendingActionChannel,
} from '../../../lib/pending-action-types'

const logger = createLogger('ai_assistant')

/**
 * GET `/api/ai/actions` — list pending AI actions visible to the caller.
 *
 * Callers see their own rows; holders of `ai_assistant.pending_actions.approve`
 * additionally see every non-chat (`mcp` / `tools-api`) row of their tenant
 * and organization. Chat rows of other users are never listed. Tenant and
 * organization always come from the authenticated session, never the query.
 */

const REQUIRED_FEATURE = 'ai_assistant.view'

export interface PendingActionListItem extends SerializedPendingAction {
  channel: AiPendingActionChannel
  requester: { userId: string | null; apiKeyId: string | null }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Pending action (mutation approval gate) list',
  methods: {
    GET: {
      operationId: 'aiAssistantListPendingActions',
      summary: 'List AI pending actions visible to the caller.',
      description:
        'Returns a page of tenant-scoped pending actions. Without the ' +
        '`ai_assistant.pending_actions.approve` feature (or with `mine=true`) only the ' +
        "caller's own rows are listed; approvers also see MCP and tools-api rows of other " +
        'users in the same tenant and organization. Chat rows of other users are never ' +
        'listed. Server-internal fields (`normalizedInput`, `idempotencyKey`) are stripped ' +
        'by a whitelist serializer. Filters: `status`, `channel`, `toolName`, `mine`. ' +
        '`pageSize` defaults to 25 and is capped at 100.',
      responses: [
        {
          status: 200,
          description:
            '`{ items, total, page, pageSize }`; each item is the serialized pending action ' +
            'plus `channel` and `requester: { userId, apiKeyId }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

function serializeListItem(row: AiPendingAction): PendingActionListItem {
  return {
    ...serializePendingActionForClient(row),
    channel: row.channel ?? 'agent',
    requester: {
      userId: row.createdByUserId ?? null,
      apiKeyId: row.apiKeyId ?? null,
    },
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const url = new URL(req.url)
  const queryResult = aiPendingActionListQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  )
  if (!queryResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }
  const query = queryResult.data

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
      return NextResponse.json({ items: [], total: 0, page: query.page, pageSize: query.pageSize })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiPendingActionRepository(em)
    const result = await repo.listForCaller(
      { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
      {
        userId: auth.sub,
        canApproveAny: hasRequiredFeatures(
          [AI_PENDING_ACTION_APPROVE_FEATURE],
          acl.features,
          acl.isSuperAdmin,
        ),
      },
      {
        status: query.status,
        channel: query.channel,
        toolName: query.toolName,
        mine: query.mine,
      },
      { page: query.page, pageSize: query.pageSize },
    )

    return NextResponse.json({
      items: result.items.map(serializeListItem),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (error) {
    logger.error('AI Pending Action list GET — Failure', { err: error })
    return jsonError(500, 'Failed to list pending actions.', 'internal_error')
  }
}
