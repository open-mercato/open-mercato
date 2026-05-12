import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiTokenUsageRepository } from '../../../../data/repositories/AiTokenUsageRepository'
import { hasRequiredFeatures } from '../../../../lib/auth'

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be a date in YYYY-MM-DD format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be a date in YYYY-MM-DD format'),
  agentId: z.string().min(1).max(256).optional(),
  modelId: z.string().min(1).max(256).optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Token usage daily rollup',
  methods: {
    GET: {
      operationId: 'aiAssistantUsageDaily',
      summary: 'Fetch daily token-usage rollup rows for a date window.',
      description:
        'Returns aggregated token-usage data from `ai_token_usage_daily` for the given ' +
        'date window. Tenant-scoped. Optionally filtered by `agentId` and/or `modelId`. ' +
        'Requires `ai_assistant.settings.manage`.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Array of daily rollup rows.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 500, description: 'Internal failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

function jsonError(status: number, message: string, code: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const { searchParams } = new URL(req.url)
  const rawQuery = {
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    agentId: searchParams.get('agentId') ?? undefined,
    modelId: searchParams.get('modelId') ?? undefined,
  }

  const queryResult = querySchema.safeParse(rawQuery)
  if (!queryResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }

  const { from, to, agentId, modelId } = queryResult.data

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
      return NextResponse.json({ rows: [], total: 0 })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiTokenUsageRepository(em)
    const rows = await repo.listDailyRollup(auth.tenantId, from, to, { agentId, modelId })

    const serialized = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId ?? null,
      day: row.day,
      agentId: row.agentId,
      modelId: row.modelId,
      providerId: row.providerId,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      reasoningTokens: row.reasoningTokens,
      stepCount: row.stepCount,
      turnCount: row.turnCount,
      sessionCount: row.sessionCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))

    return NextResponse.json({ rows: serialized, total: serialized.length })
  } catch (error) {
    console.error('[AI Usage Daily] GET error:', error)
    return jsonError(500, 'Failed to fetch daily usage data.', 'internal_error')
  }
}
