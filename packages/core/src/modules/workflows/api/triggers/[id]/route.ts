/**
 * Workflow Event Trigger Detail API
 *
 * Endpoints:
 * - GET /api/workflows/triggers/[id] - Get event trigger
 * - PUT /api/workflows/triggers/[id] - Update event trigger
 * - DELETE /api/workflows/triggers/[id] - Delete event trigger (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowEventTrigger, WorkflowDefinition } from '../../../data/entities'
import {
  updateEventTriggerInputSchema,
  type UpdateEventTriggerApiInput,
} from '../../../data/validators'
import { invalidateTriggerCache } from '../../../lib/event-trigger-service'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.triggers.view'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/workflows/triggers/[id]
 *
 * Get a single workflow event trigger by ID
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

    const trigger = await em.findOne(WorkflowEventTrigger, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!trigger) {
      return NextResponse.json(
        { error: 'Workflow event trigger not found' },
        { status: 404 }
      )
    }

    // Get workflow definition info
    const definition = await em.findOne(WorkflowDefinition, {
      id: trigger.workflowDefinitionId,
    })

    return NextResponse.json({
      data: {
        ...trigger,
        workflowDefinition: definition
          ? {
              id: definition.id,
              workflowId: definition.workflowId,
              workflowName: definition.workflowName,
              enabled: definition.enabled,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('Error getting workflow event trigger:', error)
    return NextResponse.json(
      { error: 'Failed to get workflow event trigger' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/workflows/triggers/[id]
 *
 * Update a workflow event trigger
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
      ['workflows.triggers.edit'],
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
    const validation = updateEventTriggerInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: UpdateEventTriggerApiInput = validation.data

    // Find existing trigger
    const trigger = await em.findOne(WorkflowEventTrigger, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!trigger) {
      return NextResponse.json(
        { error: 'Workflow event trigger not found' },
        { status: 404 }
      )
    }

    // If updating workflow definition ID, verify it exists
    if (input.workflowDefinitionId && input.workflowDefinitionId !== trigger.workflowDefinitionId) {
      const definition = await em.findOne(WorkflowDefinition, {
        id: input.workflowDefinitionId,
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
    }

    // Update fields
    if (input.name !== undefined) trigger.name = input.name
    if (input.description !== undefined) trigger.description = input.description
    if (input.workflowDefinitionId !== undefined) trigger.workflowDefinitionId = input.workflowDefinitionId
    if (input.eventPattern !== undefined) trigger.eventPattern = input.eventPattern
    if (input.config !== undefined) trigger.config = input.config
    if (input.enabled !== undefined) trigger.enabled = input.enabled
    if (input.priority !== undefined) trigger.priority = input.priority

    trigger.updatedBy = auth.sub
    trigger.updatedAt = new Date()

    await em.flush()

    // Invalidate trigger cache
    if (tenantId && organizationId) {
      invalidateTriggerCache(tenantId, organizationId)
    }

    // Get workflow definition info
    const definition = await em.findOne(WorkflowDefinition, {
      id: trigger.workflowDefinitionId,
    })

    return NextResponse.json({
      data: {
        ...trigger,
        workflowDefinition: definition
          ? {
              id: definition.id,
              workflowId: definition.workflowId,
              workflowName: definition.workflowName,
              enabled: definition.enabled,
            }
          : null,
      },
      message: 'Workflow event trigger updated successfully',
    })
  } catch (error) {
    console.error('Error updating workflow event trigger:', error)
    return NextResponse.json(
      { error: 'Failed to update workflow event trigger' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/workflows/triggers/[id]
 *
 * Soft delete a workflow event trigger
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
      ['workflows.triggers.delete'],
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

    // Find existing trigger
    const trigger = await em.findOne(WorkflowEventTrigger, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!trigger) {
      return NextResponse.json(
        { error: 'Workflow event trigger not found' },
        { status: 404 }
      )
    }

    // Soft delete
    trigger.deletedAt = new Date()
    trigger.updatedBy = auth.sub
    trigger.updatedAt = new Date()

    await em.flush()

    // Invalidate trigger cache
    if (tenantId && organizationId) {
      invalidateTriggerCache(tenantId, organizationId)
    }

    return NextResponse.json({
      message: 'Workflow event trigger deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting workflow event trigger:', error)
    return NextResponse.json(
      { error: 'Failed to delete workflow event trigger' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow event trigger',
      description: 'Get a single workflow event trigger by ID.',
      tags: ['Workflows', 'Event Triggers'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow event trigger found',
          example: {
            data: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              name: 'Order Approval on Submit',
              description: 'Start approval workflow when order status changes to submitted',
              workflowDefinitionId: '123e4567-e89b-12d3-a456-426614174001',
              eventPattern: 'sales.orders.updated',
              config: {
                filterConditions: [
                  { field: 'status', operator: 'eq', value: 'submitted' },
                ],
                contextMapping: [
                  { targetKey: 'orderId', sourceExpression: 'id' },
                  { targetKey: 'customerId', sourceExpression: 'customerId' },
                ],
              },
              enabled: true,
              priority: 100,
              workflowDefinition: {
                id: '123e4567-e89b-12d3-a456-426614174001',
                workflowId: 'order-approval',
                workflowName: 'Order Approval Workflow',
                enabled: true,
              },
              tenantId: '123e4567-e89b-12d3-a456-426614174002',
              organizationId: '123e4567-e89b-12d3-a456-426614174003',
              createdAt: '2025-12-08T10:00:00.000Z',
              updatedAt: '2025-12-08T10:00:00.000Z',
            },
          },
        },
        {
          status: 404,
          description: 'Workflow event trigger not found',
          example: {
            error: 'Workflow event trigger not found',
          },
        },
      ],
    },
    PUT: {
      summary: 'Update workflow event trigger',
      description: 'Update an existing workflow event trigger. Supports partial updates - only provided fields will be updated.',
      tags: ['Workflows', 'Event Triggers'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      requestBody: {
        schema: updateEventTriggerInputSchema,
        example: {
          enabled: false,
          priority: 200,
          config: {
            filterConditions: [
              { field: 'status', operator: 'eq', value: 'submitted' },
              { field: 'totalAmount', operator: 'gte', value: 1000 },
            ],
            contextMapping: [
              { targetKey: 'orderId', sourceExpression: 'id' },
              { targetKey: 'customerId', sourceExpression: 'customerId' },
              { targetKey: 'amount', sourceExpression: 'totalAmount' },
            ],
            maxConcurrentInstances: 5,
          },
        },
      },
      responses: [
        {
          status: 200,
          description: 'Workflow event trigger updated successfully',
          example: {
            data: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              name: 'Order Approval on Submit',
              description: 'Start approval workflow when order status changes to submitted',
              workflowDefinitionId: '123e4567-e89b-12d3-a456-426614174001',
              eventPattern: 'sales.orders.updated',
              config: {
                filterConditions: [
                  { field: 'status', operator: 'eq', value: 'submitted' },
                  { field: 'totalAmount', operator: 'gte', value: 1000 },
                ],
                contextMapping: [
                  { targetKey: 'orderId', sourceExpression: 'id' },
                  { targetKey: 'customerId', sourceExpression: 'customerId' },
                  { targetKey: 'amount', sourceExpression: 'totalAmount' },
                ],
                maxConcurrentInstances: 5,
              },
              enabled: false,
              priority: 200,
              workflowDefinition: {
                id: '123e4567-e89b-12d3-a456-426614174001',
                workflowId: 'order-approval',
                workflowName: 'Order Approval Workflow',
                enabled: true,
              },
              tenantId: '123e4567-e89b-12d3-a456-426614174002',
              organizationId: '123e4567-e89b-12d3-a456-426614174003',
              createdAt: '2025-12-08T10:00:00.000Z',
              updatedAt: '2025-12-08T11:30:00.000Z',
            },
            message: 'Workflow event trigger updated successfully',
          },
        },
        {
          status: 400,
          description: 'Validation error',
          example: {
            error: 'Validation failed',
            details: [
              {
                code: 'invalid_string',
                message: 'Event pattern must be "*" or a dot-separated pattern with optional wildcards',
                path: ['eventPattern'],
              },
            ],
          },
        },
        {
          status: 404,
          description: 'Workflow event trigger not found',
          example: {
            error: 'Workflow event trigger not found',
          },
        },
      ],
    },
    DELETE: {
      summary: 'Delete workflow event trigger',
      description: 'Soft delete a workflow event trigger.',
      tags: ['Workflows', 'Event Triggers'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow event trigger deleted successfully',
          example: {
            message: 'Workflow event trigger deleted successfully',
          },
        },
        {
          status: 404,
          description: 'Workflow event trigger not found',
          example: {
            error: 'Workflow event trigger not found',
          },
        },
      ],
    },
  },
}
