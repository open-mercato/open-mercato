/**
 * Rerun from step (spec §8.4)
 *
 * Endpoint:
 * - POST /api/workflows/instances/[id]/rerun-step  { stepId, contextPatch? }
 *
 * **No step-state-machine change.** The terminal `StepInstance` of the previous
 * attempt is read (for its recorded `stepType`) and then left untouched; the
 * new attempt gets a FRESH row, because `stepHandler.enterStep` creates one
 * unconditionally on every entry. Both attempts stay in the audit trail and no
 * status is ever set out of order.
 *
 * The cursor move plus `executeStep` is the same shape the definition-level
 * error handler already uses (`enterErrorHandlerStep`), so no transition record
 * is invented either.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { WorkflowInstance, StepInstance } from '../../../../data/entities'
import { findDefinitionForInstance } from '../../../../lib/find-definition'
import { logWorkflowEvent, WorkflowEventTypes } from '../../../../lib/event-logger'
import { computeContextDiff, resolveRerunEligibility } from '../../../../lib/rerun-from-step'
import * as workflowExecutor from '../../../../lib/workflow-executor'
import { workflowInstanceResponseSchema } from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.rerun_step'],
}

const requestSchema = z.object({
  stepId: z.string().min(1),
  contextPatch: z.record(z.string(), z.unknown()).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
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
      return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.rerun_step'],
      { tenantId, organizationId }
    )
    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const parsed = requestSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      organizationId,
    })
    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 })
    }

    const definition = await findDefinitionForInstance(em, instance)
    if (!definition) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    const stepExecutions = (await em.find(StepInstance, {
      workflowInstanceId: instance.id,
      stepId: parsed.data.stepId,
      tenantId,
      organizationId,
    })) as StepInstance[]

    const eligibility = resolveRerunEligibility({
      instanceStatus: instance.status,
      stepId: parsed.data.stepId,
      definitionSteps: definition.definition.steps.map((step: { stepId: string; stepType: string }) => ({
        stepId: step.stepId,
        stepType: step.stepType,
      })),
      stepExecutions: stepExecutions.map((execution) => ({
        id: execution.id,
        stepId: execution.stepId,
        stepType: execution.stepType,
        status: execution.status,
        enteredAt: execution.enteredAt ?? null,
        createdAt: execution.createdAt,
      })),
    })

    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.message, code: eligibility.code }, { status: 409 })
    }

    const editedContextDiff = computeContextDiff(instance.context, parsed.data.contextPatch)
    const now = new Date()

    // Every rerun logs a workflow event — the terminal StepInstance is never
    // touched, so the event log is what links the two attempts.
    await logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      eventType: WorkflowEventTypes.STEP_RERUN,
      eventData: {
        stepId: parsed.data.stepId,
        editedContextDiff,
        by: auth.sub,
        supersededStepInstanceId: eligibility.supersededStepInstanceId,
        previousStatus: instance.status,
      },
      userId: auth.sub,
      tenantId,
      organizationId,
    })

    if (parsed.data.contextPatch) {
      instance.context = { ...(instance.context || {}), ...parsed.data.contextPatch }
    }
    // Leaving the failure queue is exactly the marker going away.
    if (instance.metadata?.attention) {
      instance.metadata = { ...instance.metadata, attention: null }
    }
    instance.pendingTransition = null
    instance.currentStepId = parsed.data.stepId
    instance.status = 'RUNNING'
    instance.retryCount = (instance.retryCount || 0) + 1
    instance.errorMessage = null
    instance.errorDetails = null
    instance.updatedAt = now
    await em.flush()

    const { executeStep } = await import('../../../../lib/step-handler')
    await executeStep(
      em,
      instance,
      parsed.data.stepId,
      { workflowContext: instance.context || {}, userId: auth.sub },
      container
    )

    // Drive the run forward from the replayed step, exactly as any other
    // advance would.
    const execution = await workflowExecutor.executeWorkflow(em, container, instance.id)
    await em.refresh(instance)

    return NextResponse.json({
      data: { instance, execution, editedContextDiff },
      message: 'Step rerun started.',
    })
  } catch (error) {
    logger.error('Error rerunning workflow step', { err: error })
    if (error instanceof workflowExecutor.WorkflowExecutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to rerun the workflow step' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Rerun a workflow instance from a step',
      description:
        'Replay a FAILED or PAUSED instance from one of its executed steps, optionally with an edited context patch. The previous attempt keeps its terminal step-instance row; the replay gets a fresh one, and the rerun is audited as a STEP_RERUN workflow event.',
      tags: ['Workflows'],
      params: z.object({ id: z.string().uuid() }),
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
        description: 'Step to replay and an optional context patch applied before it runs.',
      },
      responses: [
        {
          status: 200,
          description: 'Rerun started',
          schema: z.object({
            data: z.object({
              instance: workflowInstanceResponseSchema,
              execution: z.unknown(),
              editedContextDiff: z.record(z.string(), z.unknown()),
            }),
            message: z.string(),
          }),
        },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Insufficient permissions', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Workflow instance not found', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'The step cannot be rerun (still parked, changed type, or the instance is not rerunnable)',
          schema: z.object({ error: z.string(), code: z.string() }),
        },
        { status: 500, description: 'Internal server error', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
