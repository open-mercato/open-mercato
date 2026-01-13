/**
 * Retry Workflow Instance API
 *
 * Endpoint:
 * - POST /api/workflows/instances/[id]/retry - Retry a failed workflow instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowInstance } from '../../../../data/entities'
import * as workflowExecutor from '../../../../lib/workflow-executor'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.retry'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/workflows/instances/[id]/retry
 *
 * Retry a failed workflow instance
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const params = await context.params
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

    // Check retry permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.retry'],
      {
        tenantId,
        organizationId,
      }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!instance) {
      return NextResponse.json(
        { error: 'Workflow instance not found' },
        { status: 404 }
      )
    }

    // Check if instance can be retried
    if (instance.status !== 'FAILED') {
      return NextResponse.json(
        {
          error: `Cannot retry workflow in ${instance.status} status. Only FAILED workflows can be retried.`,
        },
        { status: 400 }
      )
    }

    // Reset instance to RUNNING status and increment retry count
    instance.status = 'RUNNING'
    instance.retryCount = (instance.retryCount || 0) + 1
    instance.errorMessage = null
    instance.errorDetails = null
    instance.updatedAt = new Date()

    await em.flush()

    // Execute workflow from current step
    const result = await workflowExecutor.executeWorkflow(em, container, instance.id)

    // Reload instance to get final state
    await em.refresh(instance)

    return NextResponse.json({
      data: {
        instance,
        execution: result,
      },
      message: 'Workflow retry initiated successfully',
    })
  } catch (error) {
    console.error('Error retrying workflow instance:', error)

    // Handle specific errors
    if (error instanceof workflowExecutor.WorkflowExecutionError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to retry workflow instance' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Retry failed workflow instance',
      description: 'Retry a failed workflow instance from its current step. The workflow will be reset to RUNNING status and execution will continue.',
      tags: ['Workflows'],
      params: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow retry initiated successfully',
          schema: z.object({
            data: z.object({
              instance: z.any(),
              execution: z.any(),
            }),
            message: z.string(),
          }),
        },
        {
          status: 400,
          description: 'Bad request - Workflow cannot be retried in current status or execution error',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 403,
          description: 'Forbidden - Insufficient permissions',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Workflow instance not found',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 500,
          description: 'Internal server error',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
