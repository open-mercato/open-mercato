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
import { completeUserTask } from '../../../../lib/task-handler'
import {
  workflowsTag,
  completeTaskRequestSchema as openApiCompleteTaskSchema,
  userTaskCompleteResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.complete'],
}

// Request body schema
const completeTaskSchema = z.object({
  formData: z.record(z.string(), z.any()),
  comments: z.string().optional(),
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

    const { formData, comments } = parseResult.data

    // Verify task belongs to this tenant/org before completing
    const { UserTask } = await import('../../../../data/entities')
    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // Call task handler to complete task and resume workflow
    await completeUserTask(em, container, {
      taskId: params.id,
      formData,
      userId: auth.sub,
      comments,
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
    console.error('Error completing user task:', error)

    // Handle specific error codes from task-handler
    if (error instanceof Error) {
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
        { status: 404, description: 'Task not found', schema: workflowErrorSchema },
        { status: 409, description: 'Task already completed', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
