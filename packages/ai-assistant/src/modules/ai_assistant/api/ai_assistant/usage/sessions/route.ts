import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { hasRequiredFeatures } from '../../../../lib/auth'

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'

const MAX_PAGE_SIZE = 100

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be a date in YYYY-MM-DD format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be a date in YYYY-MM-DD format'),
  agentId: z.string().min(1).max(256).optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? parseInt(val, 10) : MAX_PAGE_SIZE))
    .refine((val) => !isNaN(val) && val > 0 && val <= MAX_PAGE_SIZE, {
      message: `limit must be between 1 and ${MAX_PAGE_SIZE}`,
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? parseInt(val, 10) : 0))
    .refine((val) => !isNaN(val) && val >= 0, { message: 'offset must be a non-negative integer' }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Per-session token usage totals',
  methods: {
    GET: {
      operationId: 'aiAssistantUsageSessions',
      summary: 'List per-session token usage totals for a date window.',
      description:
        'Returns aggregated token-usage data grouped by `session_id` from `ai_token_usage_events` ' +
        'for the given date window. Tenant-scoped. Optionally filtered by `agentId`. ' +
        'Paginated via `limit` / `offset`. Requires `ai_assistant.settings.manage`.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Array of session-level usage summaries plus pagination metadata.',
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
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  }

  const queryResult = querySchema.safeParse(rawQuery)
  if (!queryResult.success) {
    return jsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }

  const { from, to, agentId, limit, offset } = queryResult.data

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
      return NextResponse.json({ sessions: [], total: 0, limit, offset })
    }

    const em = container.resolve<EntityManager>('em')
    const connection = em.getConnection()

    const params: unknown[] = [auth.tenantId, from, to]
    let agentFilter = ''
    if (agentId) {
      agentFilter = 'and agent_id = ?'
      params.push(agentId)
    }

    const countParams = [...params]
    const countSql = `
      select count(distinct session_id)::bigint as total
      from ai_token_usage_events
      where tenant_id = ?
        and created_at >= ?::date
        and created_at < (?::date + interval '1 day')
        ${agentFilter}
    `
    const countRows = await connection.execute(countSql, countParams, 'all')
    const totalRaw = Array.isArray(countRows) && countRows.length > 0
      ? (countRows[0] as Record<string, unknown>).total
      : '0'
    const total = typeof totalRaw === 'string' ? parseInt(totalRaw, 10) : (totalRaw as number) ?? 0

    params.push(limit, offset)
    const dataSql = `
      select
        session_id,
        agent_id,
        module_id,
        user_id,
        min(created_at) as started_at,
        max(created_at) as last_event_at,
        count(*)::bigint as step_count,
        count(distinct turn_id)::bigint as turn_count,
        sum(input_tokens)::bigint as input_tokens,
        sum(output_tokens)::bigint as output_tokens,
        sum(coalesce(cached_input_tokens, 0))::bigint as cached_input_tokens,
        sum(coalesce(reasoning_tokens, 0))::bigint as reasoning_tokens
      from ai_token_usage_events
      where tenant_id = ?
        and created_at >= ?::date
        and created_at < (?::date + interval '1 day')
        ${agentFilter}
      group by session_id, agent_id, module_id, user_id
      order by started_at desc
      limit ? offset ?
    `
    const dataRows = await connection.execute(dataSql, params, 'all')

    const sessions = Array.isArray(dataRows)
      ? (dataRows as Array<Record<string, unknown>>).map((row) => ({
          sessionId: row.session_id as string,
          agentId: row.agent_id as string,
          moduleId: row.module_id as string,
          userId: row.user_id as string,
          startedAt: (row.started_at as Date).toISOString(),
          lastEventAt: (row.last_event_at as Date).toISOString(),
          stepCount: typeof row.step_count === 'string' ? parseInt(row.step_count, 10) : (row.step_count as number),
          turnCount: typeof row.turn_count === 'string' ? parseInt(row.turn_count, 10) : (row.turn_count as number),
          inputTokens: typeof row.input_tokens === 'string' ? parseInt(row.input_tokens, 10) : (row.input_tokens as number),
          outputTokens: typeof row.output_tokens === 'string' ? parseInt(row.output_tokens, 10) : (row.output_tokens as number),
          cachedInputTokens: typeof row.cached_input_tokens === 'string' ? parseInt(row.cached_input_tokens, 10) : (row.cached_input_tokens as number),
          reasoningTokens: typeof row.reasoning_tokens === 'string' ? parseInt(row.reasoning_tokens, 10) : (row.reasoning_tokens as number),
        }))
      : []

    return NextResponse.json({ sessions, total, limit, offset })
  } catch (error) {
    console.error('[AI Usage Sessions] GET error:', error)
    return jsonError(500, 'Failed to fetch session usage data.', 'internal_error')
  }
}
