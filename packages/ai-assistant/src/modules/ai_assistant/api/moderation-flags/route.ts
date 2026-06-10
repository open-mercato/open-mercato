import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiModerationFlagRepository } from '../../data/repositories/AiModerationFlagRepository'
import { hasRequiredFeatures } from '../../lib/auth'

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'
const MAX_PAGE_SIZE = 100

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  agentId: z.string().min(1).max(256).optional(),
  userId: z.string().min(1).max(256).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be a date in YYYY-MM-DD format').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be a date in YYYY-MM-DD format').optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Input moderation flags audit log',
  methods: {
    GET: {
      operationId: 'aiAssistantModerationFlags',
      summary: 'List input-moderation audit flags for the current tenant.',
      description:
        'Returns the append-only `ai_moderation_flags` audit rows (category flags + scores only — never ' +
        'prompt content) for the caller\'s tenant. Always tenant-scoped; cross-tenant access is impossible. ' +
        'Optionally filtered by `agentId`, `userId`, and a `from`/`to` date window. Paginated (`pageSize` ≤ 100). ' +
        'Requires `ai_assistant.settings.manage`.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Paginated moderation-flag rows: `{ items, total, page, pageSize }`.',
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
  path: '/ai_assistant/moderation-flags',
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
  const queryResult = querySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    agentId: searchParams.get('agentId') ?? undefined,
    userId: searchParams.get('userId') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  })
  if (!queryResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }

  const { page, pageSize, agentId, userId, from, to } = queryResult.data

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
      return NextResponse.json({ items: [], total: 0, page, pageSize })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiModerationFlagRepository(em)
    const { items, total } = await repo.list({
      tenantId: auth.tenantId,
      // Tenant-scoped abuse audit: do NOT narrow by organization_id. Tenant is
      // the hard isolation boundary; portal-surface flags often carry no org,
      // and a tenant admin reviewing abuse needs every flag in the tenant.
      agentId,
      userId,
      // `to` is an inclusive day; extend to end-of-day so same-day rows match.
      from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
      page,
      pageSize,
    })

    const serialized = items.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId ?? null,
      agentId: row.agentId,
      userId: row.userId,
      providerId: row.providerId,
      modelId: row.modelId,
      categories: row.categories,
      createdAt: row.createdAt.toISOString(),
    }))

    return NextResponse.json({ items: serialized, total, page, pageSize })
  } catch (error) {
    console.error('[AI Moderation Flags] GET error:', error)
    return jsonError(500, 'Failed to fetch moderation flags.', 'internal_error')
  }
}
