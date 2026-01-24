/**
 * Workflow Event Triggers API
 *
 * Endpoints:
 * - GET /api/workflows/triggers - List event triggers
 * - POST /api/workflows/triggers - Create event trigger
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowEventTrigger, WorkflowDefinition } from '../../data/entities'
import {
  createEventTriggerInputSchema,
  type CreateEventTriggerApiInput,
} from '../../data/validators'
import { invalidateTriggerCache } from '../../lib/event-trigger-service'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.triggers.view'],
}

/**
 * GET /api/workflows/triggers
 *
 * List workflow event triggers with optional filters
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

    const { searchParams } = new URL(request.url)
    const enabled = searchParams.get('enabled')
    const eventPattern = searchParams.get('eventPattern')
    const workflowDefinitionId = searchParams.get('workflowDefinitionId')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause with tenant scoping
    const where: any = {
      tenantId,
      organizationId,
      deletedAt: null,
    }

    if (enabled !== null) {
      where.enabled = enabled === 'true'
    }

    if (eventPattern) {
      where.eventPattern = { $ilike: `%${eventPattern}%` }
    }

    if (workflowDefinitionId) {
      where.workflowDefinitionId = workflowDefinitionId
    }

    if (search) {
      where.$or = [
        { name: { $ilike: `%${search}%` } },
        { eventPattern: { $ilike: `%${search}%` } },
        { description: { $ilike: `%${search}%` } },
      ]
    }

    const [triggers, total] = await em.findAndCount(
      WorkflowEventTrigger,
      where,
      {
        orderBy: { priority: 'DESC', createdAt: 'DESC' },
        limit,
        offset,
      }
    )

    // Enrich with workflow definition names
    const definitionIds = [...new Set(triggers.map((t: WorkflowEventTrigger) => t.workflowDefinitionId))]
    const definitions = await em.find(WorkflowDefinition, {
      id: { $in: definitionIds },
    })
    const definitionMap = new Map<string, WorkflowDefinition>(
      definitions.map((d: WorkflowDefinition) => [d.id, d] as [string, WorkflowDefinition])
    )

    const enrichedTriggers = triggers.map((trigger: WorkflowEventTrigger) => {
      const definition = definitionMap.get(trigger.workflowDefinitionId)
      return {
        ...trigger,
        workflowDefinition: definition
          ? {
              id: definition.id,
              workflowId: definition.workflowId,
              workflowName: definition.workflowName,
              enabled: definition.enabled,
            }
          : null,
      }
    })

    return NextResponse.json({
      data: enrichedTriggers,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('Error listing workflow event triggers:', error)
    return NextResponse.json(
      { error: 'Failed to list workflow event triggers' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workflows/triggers
 *
 * Create a new workflow event trigger
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

    // Check create permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.triggers.create'],
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
    const validation = createEventTriggerInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: CreateEventTriggerApiInput = validation.data

    // Verify workflow definition exists
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

    // Create event trigger
    const trigger = em.create(WorkflowEventTrigger, {
      name: input.name,
      description: input.description,
      workflowDefinitionId: input.workflowDefinitionId,
      eventPattern: input.eventPattern,
      config: input.config,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      tenantId,
      organizationId,
      createdBy: auth.sub,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await em.persistAndFlush(trigger)

    // Invalidate trigger cache
    if (tenantId && organizationId) {
      invalidateTriggerCache(tenantId, organizationId)
    }

    return NextResponse.json(
      {
        data: {
          ...trigger,
          workflowDefinition: {
            id: definition.id,
            workflowId: definition.workflowId,
            workflowName: definition.workflowName,
            enabled: definition.enabled,
          },
        },
        message: 'Workflow event trigger created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating workflow event trigger:', error)
    return NextResponse.json(
      { error: 'Failed to create workflow event trigger' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'List workflow event triggers',
      description: 'Get a list of workflow event triggers with optional filters. Supports pagination and search.',
      tags: ['Workflows', 'Event Triggers'],
      query: z.object({
        enabled: z.boolean().optional(),
        eventPattern: z.string().optional(),
        workflowDefinitionId: z.string().uuid().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().default(50).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of workflow event triggers with pagination',
          example: {
            data: [
              {
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
            ],
            pagination: {
              total: 1,
              limit: 50,
              offset: 0,
              hasMore: false,
            },
          },
        },
      ],
    },
    POST: {
      summary: 'Create workflow event trigger',
      description: 'Create a new workflow event trigger. When a matching event is emitted, the specified workflow will be automatically started.',
      tags: ['Workflows', 'Event Triggers'],
      requestBody: {
        schema: createEventTriggerInputSchema,
        example: {
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
            maxConcurrentInstances: 10,
          },
          enabled: true,
          priority: 100,
        },
      },
      responses: [
        {
          status: 201,
          description: 'Workflow event trigger created successfully',
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
                maxConcurrentInstances: 10,
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
            message: 'Workflow event trigger created successfully',
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
          description: 'Workflow definition not found',
          example: {
            error: 'Workflow definition not found',
          },
        },
      ],
    },
  },
}
