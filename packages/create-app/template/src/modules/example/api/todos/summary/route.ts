import { z } from 'zod'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { EXAMPLE_TODO_SUMMARY_SERVICE } from '../../../di'
import type { TodoSummaryService } from '../../../lib/todoSummaryCache'
import { exampleErrorSchema, exampleTag } from '../../openapi'

const logger = createLogger('example').child({ component: 'todo-summary-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
}

/**
 * Read side of the module-owned Todo cache.
 *
 * The scope comes from the session, never from the query string: a caller-supplied
 * tenant or organization would become part of the cache key and let one caller both
 * populate and read another scope's entry.
 */
export async function GET() {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!auth.orgId) return Response.json({ error: 'Organization scope required' }, { status: 400 })

    const container = await createRequestContainer()
    const service = container.resolve<TodoSummaryService>(EXAMPLE_TODO_SUMMARY_SERVICE)
    const { summary, cacheHit } = await service.read({
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    return Response.json({
      total: summary.total,
      done: summary.done,
      open: summary.open,
      cacheHit,
    })
  } catch (error) {
    logger.error('Failed to resolve todo summary', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const todoSummaryResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  cacheHit: z.boolean(),
})

const todoSummaryGetDoc: OpenApiMethodDoc = {
  summary: 'Todo count summary for the current scope',
  description:
    'Cache-aside aggregate of todo counts for the session tenant and organization. `cacheHit` reports whether the response was served from the module cache.',
  tags: [exampleTag],
  responses: [
    { status: 200, description: 'Scoped todo counts.', schema: todoSummaryResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Organization scope required', schema: exampleErrorSchema },
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
    { status: 500, description: 'Unexpected server error', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example todo summary',
  methods: {
    GET: todoSummaryGetDoc,
  },
}
