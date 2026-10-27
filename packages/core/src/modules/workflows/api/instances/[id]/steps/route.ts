/**
 * Workflow Step Instances API (spec §8.3)
 *
 * Endpoint:
 * - GET /api/workflows/instances/[id]/steps - Per-step execution record
 *
 * `StepInstance` has always recorded `inputData`, `outputData`, `errorData`,
 * `executionTimeMs` and `retryCount`, but until this route no API or page read
 * any of it. The per-step I/O inspector and the run Gantt both need it, so the
 * read surface comes first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowInstance, StepInstance } from '../../../../data/entities'
import { workflowStepInstanceRowSchema, paginationSchema } from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

/**
 * Platform cap: no list surface pages above 100 rows. A run with more step
 * executions than this reports `pagination.hasMore` so the caller can page
 * rather than silently rendering a truncated timeline.
 */
export const STEP_INSTANCE_PAGE_SIZE_MAX = 100

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

/**
 * GET /api/workflows/instances/[id]/steps
 */
export async function GET(request: NextRequest, context: RouteContext) {
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

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      ...orgFilter.where,
    })

    if (!instance) {
      return NextResponse.json({ error: 'Workflow instance not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const requestedLimit = parsePositiveInt(searchParams.get('limit'), STEP_INSTANCE_PAGE_SIZE_MAX)
    const limit = Math.min(Math.max(requestedLimit, 1), STEP_INSTANCE_PAGE_SIZE_MAX)
    const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0)

    // Ordered by when the step was entered so the Gantt and the overlay read the
    // run in execution order. `createdAt` is the tiebreaker because a step
    // instance is persisted before `enteredAt` is stamped on some paths.
    const [steps, total] = await em.findAndCount(
      StepInstance,
      {
        workflowInstanceId: params.id,
        tenantId,
        ...orgFilter.where,
      },
      {
        orderBy: [{ enteredAt: 'ASC' }, { createdAt: 'ASC' }],
        limit,
        offset,
      }
    )

    return NextResponse.json({
      data: steps,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    logger.error('Error getting workflow step instances', { err: error })
    return NextResponse.json({ error: 'Failed to get workflow step instances' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow instance step executions',
      description:
        'List the step executions recorded for a workflow instance, including per-step input, output, error payload, duration and attempt count.',
      tags: ['Workflows'],
      params: z.object({
        id: z.string().uuid(),
      }),
      query: z.object({
        limit: z.number().int().positive().max(STEP_INSTANCE_PAGE_SIZE_MAX).default(STEP_INSTANCE_PAGE_SIZE_MAX).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of step executions',
          schema: z.object({
            data: z.array(workflowStepInstanceRowSchema),
            pagination: paginationSchema,
          }),
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Workflow instance not found',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 500,
          description: 'Internal server error',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
