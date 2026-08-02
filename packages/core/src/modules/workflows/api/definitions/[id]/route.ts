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
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowDefinition } from '../../../data/entities'
import {
  updateWorkflowDefinitionInputSchema,
  type UpdateWorkflowDefinitionApiInput,
} from '../../../data/validators'
import { serializeWorkflowDefinition, serializeCodeWorkflowDefinition } from '../serialize'
import { invalidateTriggerCache } from '../../../lib/event-trigger-service'
import { getCodeWorkflow, getAllCodeWorkflows } from '../../../lib/code-registry'
import { codeWorkflowUuid } from '../../../lib/find-definition'
import { createGenericOptimisticLockReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaderIfAbsent } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

registerOptimisticLockReaderIfAbsent({
  'workflows.definition': createGenericOptimisticLockReader({
    entity: WorkflowDefinition,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  }),
})

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
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)

    // Handle code-based workflow definitions (code:<workflowId>)
    if (params.id.startsWith('code:')) {
      const workflowId = params.id.slice(5)
      const codeDef = getCodeWorkflow(workflowId)
      if (!codeDef) {
        return NextResponse.json(
          { error: 'Workflow definition not found' },
          { status: 404 }
        )
      }
      return NextResponse.json({
        data: serializeCodeWorkflowDefinition(codeDef, params.id),
      })
    }

    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      ...orgFilter.where,
      deletedAt: null,
    })

    if (!definition) {
      // Instances started from an unpersisted code definition store the
      // deterministic codeWorkflowUuid(workflowId) as their definitionId
      // (see lib/find-definition.ts). Resolve that synthetic UUID back to
      // the code registry so lookups by instance.definitionId succeed.
      const codeDef = getAllCodeWorkflows().find(
        (workflow) => codeWorkflowUuid(workflow.workflowId) === params.id
      )
      if (codeDef) {
        return NextResponse.json({
          data: serializeCodeWorkflowDefinition(codeDef, `code:${codeDef.workflowId}`),
        })
      }
      return NextResponse.json(
        { error: 'Workflow definition not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: serializeWorkflowDefinition(definition) })
  } catch (error) {
    logger.error('Error getting workflow definition', { err: error })
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
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: tenantId ?? '',
      organizationId: organizationId ?? null,
      userId: auth.sub ?? '',
      resourceKind: 'workflows.definition',
      resourceId: params.id,
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: request.headers,
      mutationPayload: input as Record<string, unknown>,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    // Handle customizing a code-based workflow definition
    if (params.id.startsWith('code:')) {
      const workflowId = params.id.slice(5)
      const codeDef = getCodeWorkflow(workflowId)
      if (!codeDef) {
        return NextResponse.json(
          { error: 'Workflow definition not found' },
          { status: 404 }
        )
      }

      // Check if an override already exists (including soft-deleted, due to unique constraint on workflowId+tenantId)
      const existingOverride = await em.findOne(WorkflowDefinition, {
        workflowId: codeDef.workflowId,
        tenantId,
      })

      let savedOverride: WorkflowDefinition
      if (existingOverride) {
        try {
          await enforceCommandOptimisticLockWithGuards(container, {
            resourceKind: 'workflows.definition',
            resourceId: existingOverride.id,
            current: existingOverride.updatedAt ?? null,
            request,
          })
        } catch (lockError) {
          if (isCrudHttpError(lockError)) {
            return NextResponse.json(lockError.body, { status: lockError.status })
          }
          throw lockError
        }
        // Revive if soft-deleted, then apply updates
        existingOverride.deletedAt = null
        existingOverride.workflowName = codeDef.workflowName
        existingOverride.description = codeDef.description
        existingOverride.version = codeDef.version
        existingOverride.definition = input.definition ?? codeDef.definition
        existingOverride.metadata = codeDef.metadata ?? null
        existingOverride.enabled = input.enabled ?? codeDef.enabled
        existingOverride.codeWorkflowId = codeDef.workflowId
        existingOverride.updatedBy = auth.sub
        existingOverride.updatedAt = new Date()
        await em.flush()
        savedOverride = existingOverride
      } else {
        // Create DB override row from code definition + user changes
        const override = em.create(WorkflowDefinition, {
          workflowId: codeDef.workflowId,
          workflowName: codeDef.workflowName,
          description: codeDef.description,
          version: codeDef.version,
          definition: input.definition ?? codeDef.definition,
          metadata: codeDef.metadata,
          enabled: input.enabled ?? codeDef.enabled,
          codeWorkflowId: codeDef.workflowId,
          tenantId,
          organizationId,
          createdBy: auth.sub,
          updatedBy: auth.sub,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        em.persist(override)
        await em.flush()
        savedOverride = override
      }

      try {
        const eventBus = container.resolve('eventBus') as
          | { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> }
          | undefined
        if (eventBus && typeof eventBus.emitEvent === 'function') {
          await eventBus.emitEvent(
            'workflows.definition.customized',
            {
              id: savedOverride.id,
              workflowId: savedOverride.workflowId,
              codeWorkflowId: savedOverride.codeWorkflowId ?? null,
              tenantId: savedOverride.tenantId,
              organizationId: savedOverride.organizationId,
              userId: auth.sub ?? null,
            },
            { tenantId: savedOverride.tenantId, organizationId: savedOverride.organizationId, persistent: true },
          )
        }
      } catch (eventError) {
        logger.error('Failed to emit workflows.definition.customized event', { err: eventError })
      }

      if (guardResult?.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: tenantId ?? '',
          organizationId: organizationId ?? null,
          userId: auth.sub ?? '',
          resourceKind: 'workflows.definition',
          resourceId: String(savedOverride.id),
          operation: 'update',
          requestMethod: 'PUT',
          requestHeaders: request.headers,
          metadata: guardResult.metadata,
        })
      }

      return NextResponse.json({
        data: serializeWorkflowDefinition(savedOverride),
        message: 'Workflow definition customized successfully',
      })
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

    try {
      await enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'workflows.definition',
        resourceId: definition.id,
        current: definition.updatedAt ?? null,
        request,
      })
    } catch (lockError) {
      if (isCrudHttpError(lockError)) {
        return NextResponse.json(lockError.body, { status: lockError.status })
      }
      throw lockError
    }

    // Update fields. workflowId is intentionally ignored — it identifies the
    // row and renaming would break references. Version is user-managed and
    // applied when supplied so the edit form can bump it explicitly.
    if (input.workflowName !== undefined) {
      definition.workflowName = input.workflowName
    }
    if (input.description !== undefined) {
      definition.description = input.description
    }
    if (input.version !== undefined) {
      definition.version = input.version
    }
    if (input.definition !== undefined) {
      definition.definition = input.definition
    }
    if (input.metadata !== undefined) {
      definition.metadata = input.metadata
    }
    if (input.enabled !== undefined) {
      definition.enabled = input.enabled
    }
    if (input.effectiveFrom !== undefined) {
      definition.effectiveFrom = input.effectiveFrom
    }
    if (input.effectiveTo !== undefined) {
      definition.effectiveTo = input.effectiveTo
    }

    definition.updatedAt = new Date()

    await em.flush()

    if (guardResult?.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: tenantId ?? '',
        organizationId: organizationId ?? null,
        userId: auth.sub ?? '',
        resourceKind: 'workflows.definition',
        resourceId: String(definition.id),
        operation: 'update',
        requestMethod: 'PUT',
        requestHeaders: request.headers,
        metadata: guardResult.metadata,
      })
    }

    // Embedded triggers may have changed; invalidate the in-memory cache so
    // the wildcard event subscriber reloads them on the next event.
    if (tenantId) invalidateTriggerCache(tenantId, organizationId ?? undefined)

    return NextResponse.json({
      data: serializeWorkflowDefinition(definition),
      message: 'Workflow definition updated successfully',
    })
  } catch (error) {
    logger.error('Error updating workflow definition', { err: error })
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

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: tenantId ?? '',
      organizationId: organizationId ?? null,
      userId: auth.sub ?? '',
      resourceKind: 'workflows.definition',
      resourceId: params.id,
      operation: 'delete',
      requestMethod: 'DELETE',
      requestHeaders: request.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
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

    if (guardResult?.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: tenantId ?? '',
        organizationId: organizationId ?? null,
        userId: auth.sub ?? '',
        resourceKind: 'workflows.definition',
        resourceId: String(definition.id),
        operation: 'delete',
        requestMethod: 'DELETE',
        requestHeaders: request.headers,
        metadata: guardResult.metadata,
      })
    }

    if (tenantId) invalidateTriggerCache(tenantId, organizationId ?? undefined)

    return NextResponse.json({
      message: 'Workflow definition deleted successfully',
    })
  } catch (error) {
    logger.error('Error deleting workflow definition', { err: error })
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
        id: z.string().describe('UUID for DB definitions, or "code:<workflowId>" for code-based definitions'),
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
