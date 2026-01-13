/**
 * Workflow Definition Detail API
 *
 * Endpoints:
 * - GET /api/workflows/definitions/[id] - Get workflow definition
 * - PUT /api/workflows/definitions/[id] - Update workflow definition
 * - DELETE /api/workflows/definitions/[id] - Delete workflow definition (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowDefinition } from '../../../data/entities'
import {
  updateWorkflowDefinitionInputSchema,
  type UpdateWorkflowDefinitionApiInput,
} from '../../../data/validators'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/workflows/definitions/[id]
 *
 * Get a single workflow definition by ID
 */
export async function GET(
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

    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!definition) {
      return NextResponse.json(
        { error: 'Workflow definition not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: definition })
  } catch (error) {
    console.error('Error getting workflow definition:', error)
    return NextResponse.json(
      { error: 'Failed to get workflow definition' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/workflows/definitions/[id]
 *
 * Update a workflow definition
 */
export async function PUT(
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

    // Check edit permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.edit'],
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
    const validation = updateWorkflowDefinitionInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: UpdateWorkflowDefinitionApiInput = validation.data

    // Find existing definition
    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!definition) {
      return NextResponse.json(
        { error: 'Workflow definition not found' },
        { status: 404 }
      )
    }

    // Update fields
    if (input.definition !== undefined) {
      definition.definition = input.definition
    }

    if (input.enabled !== undefined) {
      definition.enabled = input.enabled
    }

    definition.updatedAt = new Date()

    await em.flush()

    return NextResponse.json({
      data: definition,
      message: 'Workflow definition updated successfully',
    })
  } catch (error) {
    console.error('Error updating workflow definition:', error)
    return NextResponse.json(
      { error: 'Failed to update workflow definition' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/workflows/definitions/[id]
 *
 * Soft delete a workflow definition
 */
export async function DELETE(
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

    // Check delete permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.delete'],
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

    // Find existing definition
    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!definition) {
      return NextResponse.json(
        { error: 'Workflow definition not found' },
        { status: 404 }
      )
    }

    // Check if there are active workflow instances using this definition
    const { WorkflowInstance } = await import('../../../data/entities')
    const activeInstances = await em.count(WorkflowInstance, {
      definitionId: definition.id,
      status: { $in: ['RUNNING', 'WAITING'] },
    })

    if (activeInstances > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete workflow definition with ${activeInstances} active instance(s)`,
        },
        { status: 409 }
      )
    }

    // Soft delete
    definition.deletedAt = new Date()
    definition.updatedAt = new Date()

    await em.flush()

    return NextResponse.json({
      message: 'Workflow definition deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting workflow definition:', error)
    return NextResponse.json(
      { error: 'Failed to delete workflow definition' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow definition',
      description: 'Get a single workflow definition by ID. Returns the complete workflow structure including steps and transitions (with embedded activities).',
      tags: ['Workflows'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow definition found',
          example: {
            data: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              workflowId: 'checkout-flow',
              workflowName: 'Checkout Flow',
              description: 'Complete checkout workflow for processing orders',
              version: 1,
              definition: {
                steps: [
                  {
                    stepId: 'start',
                    stepName: 'Start',
                    stepType: 'START',
                  },
                  {
                    stepId: 'validate-cart',
                    stepName: 'Validate Cart',
                    stepType: 'AUTOMATED',
                    description: 'Validate cart items and check inventory',
                  },
                  {
                    stepId: 'payment',
                    stepName: 'Process Payment',
                    stepType: 'AUTOMATED',
                    description: 'Charge payment method',
                    retryPolicy: {
                      maxAttempts: 3,
                      backoffMs: 1000,
                    },
                  },
                  {
                    stepId: 'end',
                    stepName: 'End',
                    stepType: 'END',
                  },
                ],
                transitions: [
                  {
                    transitionId: 'start-to-validate',
                    fromStepId: 'start',
                    toStepId: 'validate-cart',
                    trigger: 'auto',
                  },
                  {
                    transitionId: 'validate-to-payment',
                    fromStepId: 'validate-cart',
                    toStepId: 'payment',
                    trigger: 'auto',
                  },
                  {
                    transitionId: 'payment-to-end',
                    fromStepId: 'payment',
                    toStepId: 'end',
                    trigger: 'auto',
                    activities: [
                      {
                        activityName: 'Send Order Confirmation',
                        activityType: 'SEND_EMAIL',
                        config: {
                          to: '{{context.customerEmail}}',
                          subject: 'Order Confirmation #{{context.orderId}}',
                          template: 'order_confirmation',
                        },
                      },
                    ],
                  },
                ],
              },
              enabled: true,
              tenantId: '123e4567-e89b-12d3-a456-426614174001',
              organizationId: '123e4567-e89b-12d3-a456-426614174002',
              createdAt: '2025-12-08T10:00:00.000Z',
              updatedAt: '2025-12-08T10:00:00.000Z',
            },
          },
        },
        {
          status: 404,
          description: 'Workflow definition not found',
          example: {
            error: 'Workflow definition not found',
          },
        },
      ],
    },
    PUT: {
      summary: 'Update workflow definition',
      description: 'Update an existing workflow definition. Supports partial updates - only provided fields will be updated.',
      tags: ['Workflows'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      requestBody: {
        schema: updateWorkflowDefinitionInputSchema,
        example: {
          definition: {
            steps: [
              {
                stepId: 'start',
                stepName: 'Start',
                stepType: 'START',
              },
              {
                stepId: 'validate-cart',
                stepName: 'Validate Cart',
                stepType: 'AUTOMATED',
              },
              {
                stepId: 'payment',
                stepName: 'Process Payment',
                stepType: 'AUTOMATED',
              },
              {
                stepId: 'confirmation',
                stepName: 'Order Confirmation',
                stepType: 'AUTOMATED',
              },
              {
                stepId: 'end',
                stepName: 'End',
                stepType: 'END',
              },
            ],
            transitions: [
              {
                transitionId: 'start-to-validate',
                fromStepId: 'start',
                toStepId: 'validate-cart',
                trigger: 'auto',
              },
              {
                transitionId: 'validate-to-payment',
                fromStepId: 'validate-cart',
                toStepId: 'payment',
                trigger: 'auto',
              },
              {
                transitionId: 'payment-to-confirmation',
                fromStepId: 'payment',
                toStepId: 'confirmation',
                trigger: 'auto',
              },
              {
                transitionId: 'confirmation-to-end',
                fromStepId: 'confirmation',
                toStepId: 'end',
                trigger: 'auto',
              },
            ],
          },
          enabled: true,
        },
      },
      responses: [
        {
          status: 200,
          description: 'Workflow definition updated successfully',
          example: {
            data: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              workflowId: 'checkout-flow',
              workflowName: 'Checkout Flow',
              description: 'Complete checkout workflow for processing orders',
              version: 1,
              definition: {
                steps: [
                  { stepId: 'start', stepName: 'Start', stepType: 'START' },
                  {
                    stepId: 'validate-cart',
                    stepName: 'Validate Cart',
                    stepType: 'AUTOMATED',
                  },
                  {
                    stepId: 'payment',
                    stepName: 'Process Payment',
                    stepType: 'AUTOMATED',
                  },
                  {
                    stepId: 'confirmation',
                    stepName: 'Order Confirmation',
                    stepType: 'AUTOMATED',
                  },
                  { stepId: 'end', stepName: 'End', stepType: 'END' },
                ],
                transitions: [
                  {
                    transitionId: 'start-to-validate',
                    fromStepId: 'start',
                    toStepId: 'validate-cart',
                    trigger: 'auto',
                  },
                  {
                    transitionId: 'validate-to-payment',
                    fromStepId: 'validate-cart',
                    toStepId: 'payment',
                    trigger: 'auto',
                  },
                  {
                    transitionId: 'payment-to-confirmation',
                    fromStepId: 'payment',
                    toStepId: 'confirmation',
                    trigger: 'auto',
                  },
                  {
                    transitionId: 'confirmation-to-end',
                    fromStepId: 'confirmation',
                    toStepId: 'end',
                    trigger: 'auto',
                  },
                ],
              },
              enabled: true,
              tenantId: '123e4567-e89b-12d3-a456-426614174001',
              organizationId: '123e4567-e89b-12d3-a456-426614174002',
              createdAt: '2025-12-08T10:00:00.000Z',
              updatedAt: '2025-12-08T11:30:00.000Z',
            },
            message: 'Workflow definition updated successfully',
          },
        },
        {
          status: 400,
          description: 'Validation error',
          example: {
            error: 'Validation failed',
            details: [
              {
                code: 'invalid_type',
                message: 'Expected object, received string',
                path: ['definition'],
              },
            ],
          },
        },
        {
          status: 404,
          description: 'Workflow definition not found',
          example: {
            error: 'Workflow definition not found',
          },
        },
      ],
    },
    DELETE: {
      summary: 'Delete workflow definition',
      description: 'Soft delete a workflow definition. Cannot be deleted if there are active workflow instances (RUNNING or WAITING status) using this definition.',
      tags: ['Workflows'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow definition deleted successfully',
          example: {
            message: 'Workflow definition deleted successfully',
          },
        },
        {
          status: 404,
          description: 'Workflow definition not found',
          example: {
            error: 'Workflow definition not found',
          },
        },
        {
          status: 409,
          description: 'Cannot delete - active workflow instances exist',
          example: {
            error: 'Cannot delete workflow definition with 3 active instance(s)',
          },
        },
      ],
    },
  },
}
