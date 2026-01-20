/**
 * Workflow Instances API
 *
 * Endpoints:
 * - GET /api/workflows/instances - List workflow instances
 * - POST /api/workflows/instances - Start a new workflow instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowInstance } from '../../data/entities'
import {
  startWorkflowInputSchema,
  type StartWorkflowApiInput,
  workflowInstanceStatusSchema,
} from '../../data/validators'
import * as workflowExecutor from '../../lib/workflow-executor'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

/**
 * GET /api/workflows/instances
 *
 * List workflow instances with optional filters
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
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    const status = searchParams.get('status')
    const correlationKey = searchParams.get('correlationKey')
    const entityType = searchParams.get('entityType')
    const entityId = searchParams.get('entityId')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause with tenant scoping
    const where: any = {
      tenantId,
      organizationId,
    }

    if (workflowId) {
      where.workflowId = workflowId
    }

    if (status) {
      where.status = status
    }

    if (correlationKey) {
      where.correlationKey = correlationKey
    }

    if (entityType) {
      where['metadata.entityType'] = entityType
    }

    if (entityId) {
      where['metadata.entityId'] = entityId
    }

    const [instances, total] = await em.findAndCount(
      WorkflowInstance,
      where,
      {
        orderBy: { createdAt: 'DESC' },
        limit,
        offset,
      }
    )

    return NextResponse.json({
      data: instances,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('Error listing workflow instances:', error)
    return NextResponse.json(
      { error: 'Failed to list workflow instances' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workflows/instances
 *
 * Start a new workflow instance
 */
export async function POST(request: NextRequest) {
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

    // Check create permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.create'],
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

    const body = await request.json()

    // Validate input
    const validation = startWorkflowInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: StartWorkflowApiInput = validation.data

    // Inject metadata.initiatedBy if not provided
    const metadata = {
      ...input.metadata,
      initiatedBy: input.metadata?.initiatedBy || auth.sub,
    }

    // Start workflow
    const instance = await workflowExecutor.startWorkflow(em, {
      workflowId: input.workflowId,
      version: input.version,
      initialContext: input.initialContext || {},
      correlationKey: input.correlationKey,
      metadata,
      tenantId,
      organizationId,
    })

    // Execute workflow in background (non-blocking for demo visibility)
    // This allows the frontend to see step-by-step progress via polling
    setImmediate(async () => {
      try {
        // Create new container and EM for background execution
        const bgContainer = await createRequestContainer()
        const bgEm = bgContainer.resolve('em')
        await workflowExecutor.executeWorkflow(bgEm, bgContainer, instance.id)
      } catch (error) {
        console.error('Background workflow execution error:', error)
      }
    })

    return NextResponse.json(
      {
        data: {
          instance,
          execution: {
            status: instance.status,
            currentStep: instance.currentStepId,
            message: 'Workflow execution started in background',
          },
        },
        message: 'Workflow started successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error starting workflow:', error)

    // Handle specific errors
    if (error instanceof workflowExecutor.WorkflowExecutionError) {
      if (error.code === 'DEFINITION_NOT_FOUND') {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        )
      }
      if (error.code === 'DEFINITION_DISABLED') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }
      if (error.code === 'INVALID_DEFINITION') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }
      if (error.code === 'START_PRE_CONDITIONS_FAILED') {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            details: error.details,
          },
          { status: 422 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Failed to start workflow' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'List workflow instances',
      description: 'Get a list of workflow instances with optional filters. Supports pagination and filtering by status, workflowId, correlationKey, etc.',
      tags: ['Workflows'],
      query: z.object({
        workflowId: z.string().optional(),
        status: workflowInstanceStatusSchema.optional(),
        correlationKey: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.number().int().positive().default(50).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of workflow instances',
          schema: z.object({
            data: z.array(z.any()),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            }),
          }),
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 500,
          description: 'Internal server error',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
    POST: {
      summary: 'Start workflow instance',
      description: 'Start a new workflow instance from a workflow definition. The workflow will execute immediately.',
      tags: ['Workflows'],
      requestBody: {
        contentType: 'application/json',
        schema: startWorkflowInputSchema,
        description: 'Workflow instance configuration including workflowId, initial context, and metadata.',
      },
      responses: [
        {
          status: 201,
          description: 'Workflow started successfully',
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
          description: 'Bad request - Validation failed or definition disabled/invalid',
          schema: z.object({
            error: z.string(),
            details: z.any().optional(),
          }),
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
          description: 'Workflow definition not found',
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
