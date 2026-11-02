/**
 * User Task Detail API
 *
 * Endpoints:
 * - GET /api/workflows/tasks/[id] - Get task details
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { UserTask } from '../../../data/entities'
import { serializeUserTask } from '../serialize'
import { loadTaskDecisionContext } from '../../../lib/task-decision-context'
import {
  workflowsTag,
  userTaskDetailResponseSchema,
  workflowErrorSchema,
} from '../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  collectTaskEntityTypesFromTasks,
  decideTaskAccess,
  resolveTaskAffordancesForRequest,
  resolveTaskRefusal,
  resolveTaskVisibilityForRequest,
  TASK_NOT_FOUND_BODY,
} from '../../../lib/task-visibility-request'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.view'],
}

/**
 * GET /api/workflows/tasks/[id]
 *
 * Get user task details by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId,
      ...orgFilter.where,
    })

    // A cross-tenant id, an organization the caller cannot see and a random uuid
    // all land here with the SAME body — existence must not be disclosed by the
    // shape of the refusal.
    if (!task) {
      return NextResponse.json(TASK_NOT_FOUND_BODY, { status: 404 })
    }

    const visibility = await resolveTaskVisibilityForRequest({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: auth.roles ?? [] },
      organizationIds: orgFilter.organizationIds ?? null,
      aclOrganizationId: orgFilter.rbacOrganizationId,
      entityTypes: collectTaskEntityTypesFromTasks([task]),
    })

    const decision = decideTaskAccess(visibility, task)
    if (!decision.visible) {
      // 404 for everyone who has no legitimate knowledge that the row exists;
      // 403-with-reason only for a caller who already sees it in a list view and
      // needs to know which binding hid its contents.
      const refusal = resolveTaskRefusal(visibility, decision)
      return NextResponse.json(refusal.body, { status: refusal.status })
    }

    // Decision buttons are DERIVED, never stored: the instance pins its
    // definition version, so re-resolving here always yields the buttons the
    // author wrote for this step. A task on a step that authored none gets an
    // empty list and completes through the plain form exactly as before.
    const { decisions, stepId, formKey } = await loadTaskDecisionContext(em, task)

    // The predicate already answered "may this caller act on this row" above.
    // Sending it is what stops the page offering a Complete button that 409s for
    // an administrator, and what lets it name the remedy (reassignment) instead.
    const affordances = resolveTaskAffordancesForRequest(visibility, task, decision)

    return NextResponse.json({
      data: {
        ...serializeUserTask(task),
        stepId,
        decisions,
        formKey,
        ...affordances,
      },
    })
  } catch (error) {
    logger.error('Error fetching user task', { err: error })
    return NextResponse.json(
      {
        error: 'Failed to fetch user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'User task detail',
  methods: {
    GET: {
      summary: 'Get task details',
      description: 'Returns complete details of a user task by ID.',
      responses: [
        { status: 200, description: 'User task details', schema: userTaskDetailResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant or organization context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        {
          status: 403,
          description:
            'The task is bound to an entity type the caller may not view. Returned only to callers holding workflows.tasks.view_all (or a superadmin), who already see the row in a list view; everyone else receives the generic 404.',
          schema: workflowErrorSchema,
        },
        { status: 404, description: 'Task not found, or not visible to the caller', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
