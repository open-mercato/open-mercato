/**
 * Portal User Task completion API
 *
 * - POST /api/workflows/portal/tasks/[id]/complete
 *
 * `actable` is the gate, and on the portal branch `actable` is true only for the
 * assignee themselves: a portal admin who can READ a company member's task gets
 * `visible` without `actable` and is refused here. The refusal is a 404, same as
 * every other portal refusal — telling an admin "you may see this but not
 * finish it" would disclose more than the read already did.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  getCustomerAuthFromRequest,
  requireCustomerFeature,
} from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { UserTask } from '../../../../../data/entities'
import { serializeUserTask } from '../../../../tasks/serialize'
import type { TaskHandlerService } from '../../../../../lib/task-handler'
import {
  decidePortalTaskAccess,
  PORTAL_TASK_REFUSAL,
  PORTAL_TASKS_COMPLETE_FEATURE,
  resolvePortalTaskPrincipal,
} from '../../../../../lib/portal-task-access'
import {
  workflowsTag,
  portalTaskCompleteRequestSchema,
  portalTaskCompleteResponseSchema,
  portalTaskErrorSchema,
} from '../../../../openapi'

const logger = createLogger('workflows')

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const completeSchema = z.object({
  formData: z.record(z.string(), z.any()),
  comments: z.string().optional(),
  decisionId: z.string().min(1).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getCustomerAuthFromRequest(request)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('customerRbacService') as CustomerRbacService

  try {
    await requireCustomerFeature(auth, [PORTAL_TASKS_COMPLETE_FEATURE], rbac)
  } catch (response) {
    return response as NextResponse
  }

  try {
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const acl = await rbac.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    const resolved = await resolvePortalTaskPrincipal({ auth, em, isPortalAdmin: acl.isPortalAdmin })
    if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status })

    const parsed = completeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid request body', details: parsed.error.format() },
        { status: 400 },
      )
    }

    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!task) {
      return NextResponse.json(PORTAL_TASK_REFUSAL.body, { status: PORTAL_TASK_REFUSAL.status })
    }

    const decision = decidePortalTaskAccess(resolved.principal, task)
    if (!decision.actable) {
      return NextResponse.json(PORTAL_TASK_REFUSAL.body, { status: PORTAL_TASK_REFUSAL.status })
    }

    const taskHandler = container.resolve('taskHandler') as TaskHandlerService
    await taskHandler.completeUserTask(em, container, {
      taskId: params.id,
      formData: parsed.data.formData,
      // The portal principal's own id. `completeUserTask` compares it against
      // `claimedBy ?? assignedTo`, which for a portal task is the same id space,
      // so its own ownership check agrees with the predicate rather than
      // fighting it.
      userId: auth.sub,
      comments: parsed.data.comments,
      decisionId: parsed.data.decisionId,
      scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
    })

    const updated = await em.findOne(UserTask, {
      id: params.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    return NextResponse.json({
      ok: true,
      task: updated ? serializeUserTask(updated) : null,
    })
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'UNKNOWN_DECISION' || code === 'FORM_VALIDATION_FAILED') {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : 'Invalid submission' },
        { status: 400 },
      )
    }
    // Anything the handler refuses on ownership or status grounds collapses into
    // the same 404 the predicate would have produced, so the act path discloses
    // no more than the read path.
    if (code === 'TASK_NOT_FOUND' || code === 'TASK_ASSIGNED_TO_ANOTHER_USER') {
      return NextResponse.json(PORTAL_TASK_REFUSAL.body, { status: PORTAL_TASK_REFUSAL.status })
    }
    logger.error('Error completing portal task', { err: error })
    return NextResponse.json({ ok: false, error: 'Failed to complete task' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Portal user task completion',
  methods: {
    POST: {
      summary: 'Complete a portal task',
      description:
        'Completes a customer-assigned task and resumes the workflow. Only the assignee may complete; a portal admin who can read a company member\'s task is refused.',
      requestBody: { schema: portalTaskCompleteRequestSchema },
      responses: [
        { status: 200, description: 'Task completed', schema: portalTaskCompleteResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request body or form data', schema: portalTaskErrorSchema },
        { status: 401, description: 'Authentication required', schema: portalTaskErrorSchema },
        { status: 403, description: 'Insufficient permissions or no company association', schema: portalTaskErrorSchema },
        { status: 404, description: 'Task not found or not actionable by this principal', schema: portalTaskErrorSchema },
        { status: 500, description: 'Internal server error', schema: portalTaskErrorSchema },
      ],
    },
  },
}
