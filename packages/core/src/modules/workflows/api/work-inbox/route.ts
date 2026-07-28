/**
 * Work Inbox API — one queue over every registered source (spec §6.2/§6.3).
 *
 * Endpoints:
 * - GET /api/workflows/work-inbox — merged, filtered, ordered work items
 *
 * `GET /api/workflows/tasks` is deliberately left untouched: new routes are free
 * (BACKWARD_COMPATIBILITY.md §7) but removing a shipped one is not, and the
 * task list is still what a third party integrates against.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import type { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeWorkInboxRow } from '../../lib/work-inbox/provider'
import { parseWorkInboxQuery } from '../../lib/work-inbox/query'
import type { WorkInboxService } from '../../lib/work-inbox/service'
import {
  collectScopedTaskEntityTypes,
  resolveTaskVisibilityForRequest,
} from '../../lib/task-visibility-request'
import {
  workflowsTag,
  workInboxListQuerySchema,
  workInboxListResponseSchema,
  workflowErrorSchema,
} from '../openapi'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.view'],
}

/**
 * GET /api/workflows/work-inbox
 *
 * Query params: kind, module, entityType, role, priority, status, overdue,
 * myWork (alias myTasks), assignedTo, workflowInstanceId, limit (max 100),
 * offset.
 */
export async function GET(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = auth.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const orgFilter = resolveOrganizationScopeFilter(organizationScope, auth)

    const { searchParams } = new URL(request.url)
    const query = parseWorkInboxQuery(searchParams, new Date())

    // §6.4, resolved ONCE for the whole merged page: one ACL load, one entity
    // classification pass, one tenant-setting read, whatever a source does with
    // it.
    const em = container.resolve<EntityManager>('em')
    const organizationIds = orgFilter.organizationIds ?? null
    const visibility = await resolveTaskVisibilityForRequest({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: auth.roles ?? [] },
      organizationIds,
      aclOrganizationId: orgFilter.rbacOrganizationId,
      entityTypes: await collectScopedTaskEntityTypes(em, { tenantId, organizationIds }),
    })

    const workInboxService = container.resolve<WorkInboxService>('workInboxService')
    const result = await workInboxService.listWorkInbox(query, {
      scope: {
        tenantId,
        organizationIds,
        userId: auth.sub,
        roles: auth.roles ?? [],
        visibility,
      },
      resolve: <T,>(name: string): T => container.resolve<T>(name),
    })

    const body: z.infer<typeof workInboxListResponseSchema> = {
      data: result.rows.map(serializeWorkInboxRow),
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + result.rows.length < result.total,
      },
      meta: {
        kinds: result.kinds,
        degradedKinds: result.degradedKinds,
      },
      // Only ever populated for a caller who already knows the rows are there —
      // a `workflows.tasks.view_all` holder or a superadmin. Its absence for
      // everyone else discloses nothing, because the entity gate removed those
      // rows in SQL before the query ran (design §3.6).
      ...(result.entityHidden.length > 0
        ? {
            diagnostics: {
              entityHidden: result.entityHidden,
              entityHiddenCount: result.entityHidden.length,
            },
          }
        : {}),
    }

    return NextResponse.json(body)
  } catch (error) {
    logger.error('Error listing the work inbox', { err: error })
    return NextResponse.json(
      {
        error: 'Failed to list the work inbox',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Work inbox',
  methods: {
    GET: {
      summary: 'List work items across every registered source',
      description:
        'Merges every registered work-inbox source (workflow user tasks, plus any module that registers a provider) into one queue, filtered by kind/module/entity type/role/priority/status/overdue and ordered by priority, then due date, then age.',
      query: workInboxListQuerySchema,
      responses: [
        { status: 200, description: 'Merged work items with pagination', schema: workInboxListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
