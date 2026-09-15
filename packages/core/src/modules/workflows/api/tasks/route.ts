/**
 * User Tasks API
 *
 * Endpoints:
 * - GET /api/workflows/tasks - List user tasks
 */

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { UserTask } from '../../data/entities'
import {
  workflowsTag,
  userTaskListQuerySchema,
  userTaskListResponseSchema,
  workflowErrorSchema,
} from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { serializeUserTask } from './serialize'
import {
  buildTaskVisibilityRequestConditions,
  collectScopedTaskEntityTypes,
  partitionTaskPage,
  resolveTaskVisibilityForRequest,
} from '../../lib/task-visibility-request'

const logger = createLogger('workflows')

const DEFAULT_TASK_LIST_LIMIT = 50
// The OpenAPI query schema documents `max(100)` and the project rule caps page
// sizes at 100, but the handler used to `parseInt` whatever arrived.
const MAX_TASK_LIST_LIMIT = 100

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.view'],
}

/**
 * GET /api/workflows/tasks
 *
 * List user tasks with optional filters
 *
 * Query params:
 * - status: Filter by task status (PENDING, IN_PROGRESS, COMPLETED, CANCELLED)
 * - assignedTo: Filter by assigned user ID
 * - workflowInstanceId: Filter by workflow instance
 * - overdue: Filter overdue tasks (true/false)
 * - myTasks: Show only tasks assigned to or claimable by current user (true/false)
 * - limit: Number of results (default 50)
 * - offset: Pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant context' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assignedTo')
    const workflowInstanceId = searchParams.get('workflowInstanceId')
    const overdue = searchParams.get('overdue') === 'true'
    const myTasks = searchParams.get('myTasks') === 'true'
    const limit = Math.min(
      parseNumberWithDefault(searchParams.get('limit'), DEFAULT_TASK_LIST_LIMIT, { min: 1, integer: true }),
      MAX_TASK_LIST_LIMIT,
    )
    const offset = parseNumberWithDefault(searchParams.get('offset'), 0, { min: 0, integer: true })

    // Build where clause with tenant scoping
    const where: any = {
      tenantId,
      ...orgFilter.where,
    }

    if (status) {
      // Handle comma-separated status values
      const statusValues = status.split(',').map(s => s.trim()).filter(Boolean)
      if (statusValues.length === 1) {
        where.status = statusValues[0]
      } else if (statusValues.length > 1) {
        where.status = { $in: statusValues }
      }
    }

    if (assignedTo) {
      where.assignedTo = assignedTo
    }

    if (workflowInstanceId) {
      where.workflowInstanceId = workflowInstanceId
    }

    if (overdue) {
      where.dueDate = { $lt: new Date() }
      where.status = { $in: ['PENDING', 'IN_PROGRESS'] }
    }

    if (myTasks) {
      // Show tasks assigned to current user or to their roles
      where.$or = [
        { assignedTo: auth.sub },
        { assignedToRoles: { $overlap: auth.roles || [] } },
      ]
    }

    // §6.4: `workflows.tasks.view` admits the caller to this endpoint, the
    // visibility rule decides which rows they get. Resolved ONCE — one ACL load,
    // one classification pass, one tenant-setting read for the whole page.
    const visibility = await resolveTaskVisibilityForRequest({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: auth.roles ?? [] },
      organizationIds: orgFilter.organizationIds ?? null,
      aclOrganizationId: orgFilter.rbacOrganizationId,
      entityTypes: await collectScopedTaskEntityTypes(em, {
        tenantId,
        organizationIds: orgFilter.organizationIds ?? null,
      }),
    })

    const visibilityConditions = buildTaskVisibilityRequestConditions(visibility)
    if (visibilityConditions.length > 0) {
      where.$and = [...(Array.isArray(where.$and) ? where.$and : []), ...visibilityConditions]
    }

    const [tasks, total] = await em.findAndCount(
      UserTask,
      where,
      {
        orderBy: { createdAt: 'DESC' },
        limit,
        offset,
      }
    )

    // The `WHERE` above IS the predicate, so for an ordinary caller this drops
    // nothing and `total` stays the count of what they may see. It runs because
    // the predicate is the single decision point and because a divergence must
    // lose a row rather than leak one.
    //
    // For a principal entitled to a diagnosis the `WHERE` deliberately omits the
    // entity gate, so the refused rows arrive here and become MARKERS rather
    // than an unexplained gap in the page (design §3.6). `hasMore` is computed
    // from the rows the query returned, not from the ones that survived, so
    // paging still walks the whole set instead of stopping early on a page whose
    // every row was hidden.
    const { visible: visibleTasks, entityHidden } = partitionTaskPage(visibility, tasks)

    const body: z.infer<typeof userTaskListResponseSchema> = {
      data: visibleTasks.map(serializeUserTask),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + tasks.length < total,
      },
      ...(entityHidden.length > 0
        ? { diagnostics: { entityHidden, entityHiddenCount: entityHidden.length } }
        : {}),
    }

    return NextResponse.json(body)
  } catch (error) {
    logger.error('Error listing user tasks', { err: error })
    return NextResponse.json(
      {
        error: 'Failed to list user tasks',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'User task management',
  methods: {
    GET: {
      summary: 'List user tasks',
      description: 'Returns paginated list of user tasks with optional filtering by status, assignee, workflow instance, overdue, and myTasks flags.',
      query: userTaskListQuerySchema,
      responses: [
        { status: 200, description: 'User tasks list with pagination', schema: userTaskListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters or missing tenant context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
