/**
 * User Task Completion API
 *
 * Endpoints:
 * - POST /api/workflows/tasks/[id]/complete - Complete a user task with form data
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { TaskHandlerService } from '../../../../lib/task-handler'
import { gateTaskAction } from '../../../../lib/task-visibility-request'
import {
  workflowsTag,
  completeTaskRequestSchema as openApiCompleteTaskSchema,
  userTaskCompleteResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.complete'],
}

// Request body schema
const completeTaskSchema = z.object({
  formData: z.record(z.string(), z.any()),
  comments: z.string().optional(),
  /**
   * The decision button the assignee pressed. Optional and additive: a task
   * without decisions completes through the plain form exactly as before.
   */
  decisionId: z.string().min(1).optional(),
})

/**
 * POST /api/workflows/tasks/[id]/complete
 *
 * Complete a user task with form data
 *
 * Request body:
 * {
 *   formData: { [key: string]: any },  // Form field values
 *   comments: string (optional)         // Optional comments
 * }
 *
 * This endpoint:
 * 1. Validates the task can be completed
 * 2. Validates form data against the task's form schema
 * 3. Updates the task with completion data
 * 4. Merges form data into workflow context
 * 5. Resumes workflow execution
 */
export async function POST(
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
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const parseResult = completeTaskSchema.safeParse(body)

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parseResult.error.format(),
        },
        { status: 400 }
      )
    }

    const { formData, comments, decisionId } = parseResult.data

    // §6.4 replaces the bare tenant/organization check that used to stand here.
    // The narrowing D-1 keeps `workflows.tasks.complete` on the route and still
    // demands: holding it no longer completes anyone ELSE's task. Refusals are
    // indistinguishable from a nonexistent id unless the caller already sees the
    // row.
    const gate = await gateTaskAction({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: auth.roles ?? [] },
      taskId: params.id,
      organizationId,
      // Complete is the one act where the gate, not the handler, decides
      // ownership: the handler leaves an OWNERLESS row open to anyone holding
      // the feature, which is exactly the pre-change semantics §6.4 narrows.
      requireOwnership: true,
    })

    if (!gate.allowed) {
      return NextResponse.json(gate.refusal.body, { status: gate.refusal.status })
    }

    const { UserTask } = await import('../../../../data/entities')

    // Call task handler to complete task and resume workflow
    const taskHandler = container.resolve<TaskHandlerService>('taskHandler')
    await taskHandler.completeUserTask(em, container, {
      taskId: params.id,
      formData,
      userId: auth.sub,
      comments,
      decisionId,
      scope: { tenantId, organizationId },
    })

    // Fetch updated task
    const updatedTask = await em.findOne(UserTask, {
      id: params.id,
      tenantId,
      organizationId,
    })

    return NextResponse.json({
      data: updatedTask,
      message: 'Task completed successfully. Workflow resumed.',
    })
  } catch (error) {
    logger.error('Error completing user task', { err: error })

    // Handle specific error codes from task-handler
    if (error instanceof Error) {
      if ((error as { code?: unknown }).code === 'UNKNOWN_DECISION') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }
      // "Task is assigned to another user" matches none of the message arms
      // below, so this refusal used to answer 500. It is a conflict.
      if ((error as { code?: unknown }).code === 'TASK_ASSIGNED_TO_ANOTHER_USER') {
        return NextResponse.json(
          { error: error.message },
          { status: 409 }
        )
      }
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        )
      }
      if (error.message.includes('validation')) {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }
      if (error.message.includes('already completed')) {
        return NextResponse.json(
          { error: error.message },
          { status: 409 }
        )
      }
    }

    return NextResponse.json(
      {
        error: 'Failed to complete user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Complete user task',
  methods: {
    POST: {
      summary: 'Complete a task with form data',
      description: 'Validates form data against task schema, updates task with completion data, merges form data into workflow context, and resumes workflow execution.',
      requestBody: {
        contentType: 'application/json',
        schema: openApiCompleteTaskSchema,
      },
      responses: [
        { status: 200, description: 'Task completed successfully', schema: userTaskCompleteResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request body, validation failed, or missing context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'The task is visible to the caller but is not theirs to act on — it has no assignee and no role queue, so it must be reassigned first (§6.4: administration widens seeing, never acting).', schema: workflowErrorSchema },
        { status: 404, description: 'Task not found, or not visible to the caller', schema: workflowErrorSchema },
        { status: 409, description: 'Task already completed', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
