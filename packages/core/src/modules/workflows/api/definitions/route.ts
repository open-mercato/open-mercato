/**
 * Workflow Definitions API
 *
 * Endpoints:
 * - GET /api/workflows/definitions - List workflow definitions
 * - POST /api/workflows/definitions - Create workflow definition
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowDefinition } from '../../data/entities'
import {
  createWorkflowDefinitionInputSchema,
  type CreateWorkflowDefinitionApiInput,
} from '../../data/validators'
import { serializeWorkflowDefinition, serializeCodeWorkflowDefinition } from './serialize'
import { invalidateTriggerCache } from '../../lib/event-trigger-service'
import { getAllCodeWorkflows } from '../../lib/code-registry'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

const WORKFLOW_ID_TENANT_UNIQUE_CONSTRAINT = 'workflow_definitions_workflow_id_tenant_id_unique'

function isWorkflowIdUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const value = error as Record<string, unknown>
  const constraint = value.constraint
  const code = value.code
  const message = typeof value.message === 'string' ? value.message : ''
  const detail = typeof value.detail === 'string' ? value.detail : ''

  if (constraint === WORKFLOW_ID_TENANT_UNIQUE_CONSTRAINT) {
    return true
  }

  if (code === '23505' && detail.includes('(workflow_id, tenant_id)')) {
    return true
  }

  return message.includes(WORKFLOW_ID_TENANT_UNIQUE_CONSTRAINT)
}

/**
 * GET /api/workflows/definitions
 *
 * List workflow definitions with optional filters
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

    const { searchParams } = new URL(request.url)
    const enabled = searchParams.get('enabled')
    const workflowId = searchParams.get('workflowId')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause with tenant scoping
    const where: any = {
      tenantId,
      ...orgFilter.where,
      deletedAt: null,
    }

    if (enabled !== null) {
      where.enabled = enabled === 'true'
    }

    if (workflowId) {
      where.workflowId = workflowId
    }

    if (search) {
      where.$or = [
        { workflowId: { $ilike: `%${search}%` } },
        { workflowName: { $ilike: `%${search}%` } },
      ]
    }

    // Determine which code workflows are shadowed by a DB row (so we can
    // exclude them from the code-only list) without loading all DB rows.
    const enabledFilter = enabled !== null ? enabled === 'true' : null
    const searchLower = search ? search.toLowerCase() : null
    const allCodeIds = getAllCodeWorkflows().map((cw) => cw.workflowId)
    const shadowed = allCodeIds.length > 0
      ? new Set(
          (
            await em.find(
              WorkflowDefinition,
              { ...where, workflowId: { $in: allCodeIds } },
              { fields: ['workflowId'] as const },
            )
          ).map((d: WorkflowDefinition) => d.workflowId),
        )
      : new Set<string>()

    const codeOnly = getAllCodeWorkflows()
      .filter((cw) => !shadowed.has(cw.workflowId))
      .filter((cw) => {
        if (searchLower) {
          const matches =
            cw.workflowId.toLowerCase().includes(searchLower) ||
            cw.workflowName.toLowerCase().includes(searchLower)
          if (!matches) return false
        }
        if (enabledFilter !== null && cw.enabled !== enabledFilter) return false
        if (workflowId && cw.workflowId !== workflowId) return false
        return true
      })
      .map((cw) => serializeCodeWorkflowDefinition(cw, `code:${cw.workflowId}`))

    const dbCount = await em.count(WorkflowDefinition, where)
    const total = dbCount + codeOnly.length

    // Fetch only the prefix of DB rows we might need to fill the requested
    // page after merging with the (already-filtered) code-only list.
    const dbWindowLimit = offset + limit
    const dbWindow = dbWindowLimit > 0
      ? await em.find(WorkflowDefinition, where, {
          orderBy: { workflowName: 'ASC' },
          limit: dbWindowLimit,
        })
      : []

    const serializedDb = dbWindow.map(serializeWorkflowDefinition)

    const merged = [...serializedDb, ...codeOnly].sort((a, b) =>
      a.workflowName.localeCompare(b.workflowName),
    )

    const paginated = merged.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('Error listing workflow definitions:', error)
    return NextResponse.json(
      { error: 'Failed to list workflow definitions' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workflows/definitions
 *
 * Create a new workflow definition
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
      ['workflows.definitions.create'],
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
    const validation = createWorkflowDefinitionInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: CreateWorkflowDefinitionApiInput = validation.data

    // workflow_id is unique per tenant; check upfront to return 409 instead of DB error.
    const existing = await em.findOne(WorkflowDefinition, {
      workflowId: input.workflowId,
      tenantId,
    })

    if (existing) {
      return NextResponse.json(
        {
          error: `Workflow definition with ID "${input.workflowId}" already exists`,
        },
        { status: 409 }
      )
    }

    // Create workflow definition
    const definition = em.create(WorkflowDefinition, {
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      description: input.description,
      version: input.version,
      definition: input.definition,
      metadata: input.metadata,
      enabled: input.enabled ?? true,
      tenantId,
      organizationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await em.persist(definition).flush()

    // Newly-created embedded triggers must be visible to the wildcard event
    // subscriber immediately; invalidate the in-memory trigger cache so the
    // next event reload picks up this definition.
    if (tenantId) invalidateTriggerCache(tenantId, organizationId ?? undefined)

    return NextResponse.json(
      {
        data: serializeWorkflowDefinition(definition),
        message: 'Workflow definition created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    if (isWorkflowIdUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: 'Workflow definition with this ID already exists' },
        { status: 409 }
      )
    }

    console.error('Error creating workflow definition:', error)
    return NextResponse.json(
      { error: 'Failed to create workflow definition' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'List workflow definitions',
      description: 'Get a list of workflow definitions with optional filters. Supports pagination and search.',
      tags: ['Workflows'],
      query: createWorkflowDefinitionInputSchema.pick({ workflowId: true }).extend({
        enabled: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().default(50).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of workflow definitions with pagination',
          example: {
            data: [
              {
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
                      transitionId: 'validate-to-end',
                      fromStepId: 'validate-cart',
                      toStepId: 'end',
                      trigger: 'auto',
                    },
                  ],
                },
                enabled: true,
                tenantId: '123e4567-e89b-12d3-a456-426614174001',
                organizationId: '123e4567-e89b-12d3-a456-426614174002',
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
      summary: 'Create workflow definition',
      description: 'Create a new workflow definition. The definition must include at least START and END steps with at least one transition connecting them.',
      tags: ['Workflows'],
      requestBody: {
        schema: createWorkflowDefinitionInputSchema,
        example: {
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
        },
      },
      responses: [
        {
          status: 201,
          description: 'Workflow definition created successfully',
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
                    transitionId: 'payment-to-end',
                    fromStepId: 'payment',
                    toStepId: 'end',
                    trigger: 'auto',
                  },
                ],
              },
              enabled: true,
              tenantId: '123e4567-e89b-12d3-a456-426614174001',
              organizationId: '123e4567-e89b-12d3-a456-426614174002',
              createdAt: '2025-12-08T10:00:00.000Z',
              updatedAt: '2025-12-08T10:00:00.000Z',
            },
            message: 'Workflow definition created successfully',
          },
        },
        {
          status: 400,
          description: 'Validation error - invalid workflow structure',
          example: {
            error: 'Validation failed',
            details: [
              {
                code: 'invalid_type',
                message: 'Workflow must have at least START and END steps',
                path: ['definition', 'steps'],
              },
            ],
          },
        },
        {
          status: 409,
          description: 'Conflict - workflow with same ID and version already exists',
          example: {
            error: 'Workflow definition with ID "checkout-flow" and version 1 already exists',
          },
        },
      ],
    },
  },
}

// Full OpenAPI documentation (kept for reference but not used by type system)
export const _openApiDetailedDocs = {
  get: {
    summary: 'List workflow definitions',
    description: 'Get a list of workflow definitions with optional filters',
    tags: ['Workflows'],
    parameters: [
      {
        name: 'enabled',
        in: 'query',
        description: 'Filter by enabled status',
        schema: { type: 'boolean' },
      },
      {
        name: 'workflowId',
        in: 'query',
        description: 'Filter by workflow ID',
        schema: { type: 'string' },
      },
      {
        name: 'search',
        in: 'query',
        description: 'Search in workflow ID and name',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of results to return',
        schema: { type: 'integer', default: 50 },
      },
      {
        name: 'offset',
        in: 'query',
        description: 'Offset for pagination',
        schema: { type: 'integer', default: 0 },
      },
    ],
    responses: {
      200: {
        description: 'List of workflow definitions',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/WorkflowDefinition' },
                },
                pagination: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  post: {
    summary: 'Create workflow definition',
    description: 'Create a new workflow definition',
    tags: ['Workflows'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateWorkflowDefinition' },
        },
      },
    },
    responses: {
      201: {
        description: 'Workflow definition created',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/WorkflowDefinition' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      400: {
        description: 'Validation error',
      },
      409: {
        description: 'Workflow definition already exists',
      },
    },
  },
}
