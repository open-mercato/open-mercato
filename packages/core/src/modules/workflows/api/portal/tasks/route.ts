/**
 * Portal User Tasks API
 *
 * - GET /api/workflows/portal/tasks — the customer's own task list
 *
 * NEW SURFACE, not a relaxation. The backoffice task routes are untouched: they
 * still require a backoffice session and still refuse a portal token, and this
 * route refuses a backoffice one. Two principals, two route trees, one shared
 * predicate — which is the only reason the isolation is testable in both
 * directions rather than merely asserted.
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
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { UserTask } from '../../../data/entities'
import { serializeUserTask } from '../../tasks/serialize'
import {
  buildPortalTaskConditions,
  filterVisiblePortalTasks,
  PORTAL_TASKS_VIEW_FEATURE,
  resolvePortalTaskPrincipal,
} from '../../../lib/portal-task-access'
import {
  workflowsTag,
  portalTaskListQuerySchema,
  portalTaskListResponseSchema,
  portalTaskErrorSchema,
} from '../../openapi'

const logger = createLogger('workflows')

const DEFAULT_PORTAL_TASK_LIMIT = 25
const MAX_PORTAL_TASK_LIMIT = 100

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

export async function GET(request: NextRequest) {
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

    const resolved = await resolvePortalTaskPrincipal({
      auth,
      em,
      isPortalAdmin: acl.isPortalAdmin,
    })
    if (!resolved.ok) {
      return NextResponse.json(resolved.body, { status: resolved.status })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page = Math.max(1, parseNumberWithDefault(searchParams.get('page'), 1, { min: 1, integer: true }))
    const pageSize = Math.min(
      parseNumberWithDefault(searchParams.get('pageSize'), DEFAULT_PORTAL_TASK_LIMIT, {
        min: 1,
        integer: true,
      }),
      MAX_PORTAL_TASK_LIMIT,
    )

    const where: Record<string, unknown> = buildPortalTaskConditions({
      principal: resolved.principal,
      assigneeIds: resolved.assigneeIds,
    })

    if (status) {
      const statusValues = status.split(',').map((value) => value.trim()).filter(Boolean)
      if (statusValues.length === 1) where.status = statusValues[0]
      else if (statusValues.length > 1) where.status = { $in: statusValues }
    }

    const [tasks, total] = await em.findAndCount(UserTask, where, {
      orderBy: { createdAt: 'DESC' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })

    // The SQL is the structural half; ownership is a per-row set membership the
    // jsonb bindings cannot express, so this genuinely drops rows rather than
    // being a belt-and-braces no-op. A drop means a task assigned to a company
    // member is bound to a record outside that company — an authoring anomaly
    // worth a log line, never a silent gap.
    const visible = filterVisiblePortalTasks(resolved.principal, tasks)
    if (visible.length !== tasks.length) {
      logger.warn('Portal task page dropped rows that failed the ownership check', {
        component: 'portal-tasks',
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        dropped: tasks.length - visible.length,
      })
    }

    const body: z.infer<typeof portalTaskListResponseSchema> = {
      ok: true,
      tasks: visible.map(serializeUserTask),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    }

    return NextResponse.json(body)
  } catch (error) {
    logger.error('Error listing portal tasks', { err: error })
    return NextResponse.json({ ok: false, error: 'Failed to list tasks' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Portal user tasks',
  methods: {
    GET: {
      summary: 'List the portal principal\'s tasks',
      description:
        'Returns the customer-assigned tasks this portal principal may see. A portal admin additionally sees their company members\' tasks but may not act on them. Tasks with no entity bindings are never portal-visible.',
      query: portalTaskListQuerySchema,
      responses: [
        { status: 200, description: 'Portal task list', schema: portalTaskListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: portalTaskErrorSchema },
        { status: 403, description: 'Insufficient permissions or no company association', schema: portalTaskErrorSchema },
        { status: 500, description: 'Internal server error', schema: portalTaskErrorSchema },
      ],
    },
  },
}
