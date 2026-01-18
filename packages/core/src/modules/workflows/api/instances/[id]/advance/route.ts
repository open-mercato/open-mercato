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
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowInstance } from '../../../../data/entities'
import * as workflowExecutor from '../../../../lib/workflow-executor'
import * as stepHandler from '../../../../lib/step-handler'
import * as transitionHandler from '../../../../lib/transition-handler'
import { z } from 'zod'

// Validation schema
const advanceWorkflowSchema = z.object({
  toStepId: z.string().optional(), // Optional - will auto-select if not provided
  triggerData: z.record(z.string(), z.any()).optional(), // Optional trigger data
  contextUpdates: z.record(z.string(), z.any()).optional(), // Optional context updates
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
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Get instance ID from params
    const params = await context.params
    const instanceId = params.id

    // Load and verify instance
    const instance = await em.findOne(WorkflowInstance, {
      id: instanceId,
      tenantId,
      organizationId,
    })

    if (!instance) {
      return NextResponse.json(
        { error: 'Workflow instance not found' },
        { status: 404 }
      )
    }

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
    const body = await request.json().catch(() => ({}))
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

    if (instance.status === 'FAILED') {
      return NextResponse.json(
        { error: 'Workflow has failed. Use retry endpoint to retry.' },
        { status: 400 }
      )
    }

    // Apply context updates if provided
    if (input.contextUpdates) {
      await workflowExecutor.updateWorkflowContext(
        em,
        instanceId,
        input.contextUpdates
      )
      await em.flush()
    }

    // Build evaluation context
    const evalContext: transitionHandler.TransitionEvaluationContext = {
      workflowContext: instance.context,
      userId: auth.sub,
      triggerData: input.triggerData,
    }

    // Find valid transitions from current step
    const validTransitions = await transitionHandler.findValidTransitions(
      em,
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

    // Select transition
    let selectedTransition: any
    if (input.toStepId) {
      // User specified target step
      const matchingTransition = validTransitionsList.find(
        (t) => t.transition?.toStepId === input.toStepId
      )

      if (!matchingTransition) {
        return NextResponse.json(
          {
            error: `No valid transition to step '${input.toStepId}'`,
            availableTransitions: validTransitionsList.map((t) => ({
              toStepId: t.transition?.toStepId,
              toStepName: t.transition?.toStepName,
            })),
          },
          { status: 400 }
        )
      }

      selectedTransition = matchingTransition.transition
    } else {
      // Auto-select first valid transition
      selectedTransition = validTransitionsList[0].transition
    }

    // Execute transition
    const execContext: transitionHandler.TransitionExecutionContext = {
      workflowContext: instance.context,
      userId: auth.sub,
      triggerData: input.triggerData,
    }

    const transitionResult = await transitionHandler.executeTransition(
      em,
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

    // Reload instance to get updated state
    await em.refresh(instance)

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
    console.error('Error advancing workflow:', error)

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
