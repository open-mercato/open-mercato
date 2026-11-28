/**
 * POST /api/workflows/instances/:id/advance
 *
 * Manually advance a workflow instance to the next step
 * Useful for:
 * - Manual workflow progression in demos
 * - Step-by-step testing
 * - User-triggered transitions
 * - Manual approval flows
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { WorkflowInstance } from '../../../../data/entities'
import type * as WorkflowExecutor from '../../../../lib/workflow-executor'
import type * as TransitionHandler from '../../../../lib/transition-handler'
import { z } from 'zod'
import {
  workflowsTag,
  advanceWorkflowRequestSchema,
  advanceWorkflowResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const logger = createLogger('workflows')

// Validation schema
const advanceWorkflowSchema = z.object({
  toStepId: z.string().optional(), // Optional - will auto-select if not provided
  triggerData: z.record(z.string(), z.unknown()).optional(), // Optional trigger data
  contextUpdates: z.record(z.string(), z.unknown()).optional(), // Optional context updates
})

type AdvanceWorkflowInput = z.infer<typeof advanceWorkflowSchema>

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/workflows/instances/:id/advance
 *
 * Advance workflow to next step
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth)

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Get instance ID from params
    const params = await context.params
    const instanceId = params.id

    // Check permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.create'], // Using create permission for advancing
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await readJsonSafe<Record<string, unknown>>(request, {})
    const validation = advanceWorkflowSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const input: AdvanceWorkflowInput = validation.data

    const workflowExecutor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
    const transitionHandler = container.resolve<typeof TransitionHandler>('transitionHandler')
    const reserved = workflowExecutor.findReservedContextKeys(input.contextUpdates ?? {})
    if (reserved.length > 0) {
      return NextResponse.json(
        { error: 'Validation failed', details: { reserved } },
        { status: 400 }
      )
    }

    const advancement = await em.transactional(async (transaction) => {
      const instance = await findOneWithDecryption(
        transaction,
        WorkflowInstance,
        { id: instanceId, tenantId, organizationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        { tenantId, organizationId },
      )
      if (!instance) {
        return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 })
      }

      // Check workflow status
      if (instance.status === 'COMPLETED') {
        return NextResponse.json(
          { error: 'Workflow already completed' },
          { status: 400 }
        )
      }

      if (instance.status === 'CANCELLED') {
        return NextResponse.json(
          { error: 'Workflow is cancelled' },
          { status: 400 }
        )
      }

<<<<<<< HEAD
    // Build evaluation context
    const evalContext: transitionHandler.TransitionEvaluationContext = {
      workflowContext: instance.context,
      userId: auth.sub,
      triggerData: input.triggerData,
    }
=======
      if (instance.status === 'FAILED') {
        return NextResponse.json(
          { error: 'Workflow has failed. Use retry endpoint to retry.' },
          { status: 400 }
        )
      }
>>>>>>> 9934e0940a (fix(security): harden platform authorization and deployment defaults (#10543))

      const workflowContext = { ...instance.context, ...input.contextUpdates }
      // Build evaluation context
      const evalContext: TransitionHandler.TransitionEvaluationContext = {
        container,
        workflowContext,
        userId: auth.sub,
        triggerData: input.triggerData,
      }

      // Find valid transitions from current step
      const validTransitions = await transitionHandler.findValidTransitions(
        transaction,
        instance,
        instance.currentStepId!,
        evalContext
      )

      const validTransitionsList = validTransitions.filter((t) => t.isValid)

      if (validTransitionsList.length === 0) {
        return NextResponse.json(
          {
            error: 'No valid transitions available',
            currentStepId: instance.currentStepId,
            reason: 'All transitions blocked by conditions or business rules',
          },
          { status: 400 }
        )
      }

      const selectedTransition = (input.toStepId
        ? validTransitionsList.find((entry) => entry.transition?.toStepId === input.toStepId)
        : validTransitionsList[0])?.transition

      if (!selectedTransition) {
        return NextResponse.json(
          {
            error: `No valid transition to step '${input.toStepId}'`,
            availableTransitions: validTransitionsList.map((entry) => ({
              toStepId: entry.transition?.toStepId,
              toStepName: entry.transition?.toStepName,
            })),
          },
          { status: 400 }
        )
      }

      // Execute transition
      const execContext: TransitionHandler.TransitionExecutionContext = {
        workflowContext,
        userId: auth.sub,
        triggerData: input.triggerData,
      }

      const transitionResult = await transitionHandler.executeTransition(
        transaction,
        container,
        instance,
        selectedTransition.fromStepId,
        selectedTransition.toStepId,
        execContext
      )

      if (!transitionResult.success) {
        return NextResponse.json(
          {
            error: 'Transition failed',
            reason: transitionResult.error || 'Unknown error',
          },
          { status: 400 }
        )
      }

      await transaction.refresh(instance)
      return { instance, selectedTransition }
    })
    if (advancement instanceof NextResponse) return advancement

    const { instance, selectedTransition } = advancement

    // Execute workflow to check if we can auto-progress further
    const executionResult = await workflowExecutor.executeWorkflow(
      em,
      container,
      instanceId,
      {
        userId: auth.sub,
      }
    )

    return NextResponse.json(
      {
        data: {
          instance: {
            id: instance.id,
            status: instance.status,
            currentStepId: instance.currentStepId,
            previousStepId: selectedTransition.fromStepId,
            transitionFired: selectedTransition.transitionId,
            context: instance.context,
          },
          execution: executionResult,
        },
        message: 'Workflow advanced successfully',
      },
      { status: 200 }
    )
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Error advancing workflow', { err: error })

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to advance workflow',
          message: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to advance workflow' },
      { status: 500 }
    )
  }
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.create'],
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Advance workflow instance',
  methods: {
    POST: {
      summary: 'Manually advance workflow to next step',
      description: 'Manually advance a workflow instance to the next step. Useful for manual progression, step-by-step testing, user-triggered transitions, and approval flows. Validates transitions and auto-progresses if possible.',
      requestBody: {
        contentType: 'application/json',
        schema: advanceWorkflowRequestSchema,
      },
      responses: [
        { status: 200, description: 'Workflow advanced successfully', schema: advanceWorkflowResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request, no valid transitions, or workflow already completed/cancelled/failed', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Workflow instance not found', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
