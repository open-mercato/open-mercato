/**
 * Portal User Task detail API
 *
 * - GET /api/workflows/portal/tasks/[id]
 *
 * Every refusal is the same 404 with the same body — a foreign task id, another
 * customer's task, an unbound task and a random uuid are indistinguishable. A
 * portal principal has no legitimate knowledge that any row they cannot read
 * exists, and a portal admin least of all.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  getCustomerAuthFromRequest,
  requireCustomerFeature,
} from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { UserTask } from '../../../../data/entities'
import { serializeUserTask } from '../../../tasks/serialize'
import { loadTaskDecisionContext } from '../../../../lib/task-decision-context'
import {
  decidePortalTaskAccess,
  PORTAL_TASK_REFUSAL,
  PORTAL_TASKS_VIEW_FEATURE,
  resolvePortalTaskPrincipal,
} from '../../../../lib/portal-task-access'
import {
  workflowsTag,
  portalTaskDetailResponseSchema,
  portalTaskErrorSchema,
} from '../../../openapi'

const logger = createLogger('workflows')

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getCustomerAuthFromRequest(request)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('customerRbacService') as CustomerRbacService

  try {
    await requireCustomerFeature(auth, [PORTAL_TASKS_VIEW_FEATURE], rbac)
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

    // Scoped at the lookup, so a foreign-tenant id resolves to nothing before the
    // predicate ever runs.
    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!task) {
      return NextResponse.json(PORTAL_TASK_REFUSAL.body, { status: PORTAL_TASK_REFUSAL.status })
    }

    const decision = decidePortalTaskAccess(resolved.principal, task)
    if (!decision.visible) {
      return NextResponse.json(PORTAL_TASK_REFUSAL.body, { status: PORTAL_TASK_REFUSAL.status })
    }

    // Re-resolved from the instance's pinned definition, exactly as the
    // backoffice detail does — the portal must offer the SAME named outcomes the
    // author wrote, or a portal completion silently takes the default route.
    const { decisions, formKey } = await loadTaskDecisionContext(em, task)

    const body: z.infer<typeof portalTaskDetailResponseSchema> = {
      ok: true,
      task: serializeUserTask(task),
      decisions,
      formKey,
      // What the UI needs to decide whether to render the completion form at
      // all. A portal admin reading a member's task gets `false` — they see the
      // work, they never finish it.
      canComplete: decision.actable,
    }

    return NextResponse.json(body)
  } catch (error) {
    logger.error('Error loading portal task', { err: error })
    return NextResponse.json({ ok: false, error: 'Failed to load task' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Portal user task detail',
  methods: {
    GET: {
      summary: 'Read one portal task',
      description:
        'Returns a single customer-assigned task the portal principal owns. Every refusal — foreign tenant, another customer, an unbound task, a nonexistent id — is the same 404.',
      responses: [
        { status: 200, description: 'Portal task', schema: portalTaskDetailResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: portalTaskErrorSchema },
        { status: 403, description: 'Insufficient permissions or no company association', schema: portalTaskErrorSchema },
        { status: 404, description: 'Task not found', schema: portalTaskErrorSchema },
        { status: 500, description: 'Internal server error', schema: portalTaskErrorSchema },
      ],
    },
  },
}
