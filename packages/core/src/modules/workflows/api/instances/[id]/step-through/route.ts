/**
 * Step-through control API (spec section 8.2)
 *
 * Endpoint:
 * - POST /api/workflows/instances/[id]/step-through - continue one step, or
 *   stop stepping and let the run finish on its own.
 *
 * "Abort" is deliberately NOT here: cancelling a run is already
 * `POST /api/workflows/instances/[id]/cancel`, and a second way to cancel would
 * be a second place to get the compensation semantics wrong.
 *
 * The release is a token for exactly ONE step id, minted server-side from the
 * instance's CURRENT step — never from the request body — so a client cannot
 * release a step the run is not sitting on.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowInstance } from '../../../../data/entities'
import * as workflowExecutor from '../../../../lib/workflow-executor'
import { logWorkflowEvent } from '../../../../lib/event-logger'
import {
  STEP_THROUGH_RELEASED_EVENT_TYPE,
  isStepThroughArmed,
  releaseStepThrough,
} from '../../../../lib/step-through'
import { workflowsTag, workflowErrorSchema } from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.test_run'],
}

const stepThroughInputSchema = z.object({
  action: z.enum(['continue', 'stop']),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const auth = await getAuthFromRequest(request)

    if (!auth?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService') as {
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<boolean>
    }
    const allowed = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.test_run'],
      { tenantId, organizationId },
    )
    if (!allowed) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const validation = stepThroughInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 },
      )
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      ...orgFilter.where,
    })

    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 })
    }

    if (!isStepThroughArmed(instance)) {
      return NextResponse.json(
        { error: 'This instance is not running in step-through mode' },
        { status: 400 },
      )
    }

    if (validation.data.action === 'stop') {
      instance.metadata = { ...(instance.metadata || {}), stepThrough: null }
      instance.updatedAt = new Date()
      await em.flush()
    } else {
      // The token is minted from the instance's own cursor, so a client can only
      // ever release the step the run is actually parked on.
      instance.metadata = {
        ...(instance.metadata || {}),
        stepThrough: releaseStepThrough(instance.currentStepId),
      }
      instance.updatedAt = new Date()
      await em.flush()

      await logWorkflowEvent(em, {
        workflowInstanceId: instance.id,
        eventType: STEP_THROUGH_RELEASED_EVENT_TYPE,
        eventData: { stepId: instance.currentStepId },
        userId: auth.sub,
        tenantId,
        organizationId: instance.organizationId,
      })
    }

    // The instance was parked with PAUSED; every resume path flips it back to
    // RUNNING before re-entering, and this one is no different.
    if (instance.status === 'PAUSED') {
      instance.status = 'RUNNING'
      instance.pausedAt = null
      instance.updatedAt = new Date()
      await em.flush()
    }

    const result = await workflowExecutor.executeWorkflow(em, container, instance.id, {
      userId: auth.sub,
    })

    return NextResponse.json({
      data: {
        instanceId: instance.id,
        status: result.status,
        currentStep: result.currentStep,
        stepThrough: instance.metadata?.stepThrough ?? null,
      },
    })
  } catch (error) {
    logger.error('Error advancing step-through run', { err: error })
    return NextResponse.json({ error: 'Failed to advance step-through run' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Step-through control',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Continue one step, or stop stepping',
      description:
        'Releases exactly the step the instance is currently parked on and resumes execution, or clears step-through so the run finishes on its own. To abort the run, use the cancel endpoint.',
      requestBody: { schema: stepThroughInputSchema, example: { action: 'continue' } },
      responses: [
        {
          status: 200,
          description: 'The run advanced',
          schema: z.object({
            data: z.object({
              instanceId: z.string(),
              status: z.string(),
              currentStep: z.string(),
              stepThrough: z
                .object({ enabled: z.literal(true), releaseStepId: z.string().nullable().optional() })
                .nullable(),
            }),
          }),
        },
        { status: 400, description: 'Not a step-through run, or malformed payload', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Workflow instance not found', schema: workflowErrorSchema },
      ],
    },
  },
}
