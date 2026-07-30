/**
 * Failure-queue triage API (spec §8.4)
 *
 * Endpoint:
 * - GET /api/workflows/instances/failure-queue
 *
 * The triage set is "instances parked by a `failureQueue` directive PLUS FAILED
 * instances". The list route cannot express that: its `attention` and `status`
 * filters are ANDed, and this is a union.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { raw } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowInstance } from '../../../data/entities'
import { workflowInstanceResponseSchema, paginationSchema } from '../../openapi'
import {
  groupFailures,
  matchesFailureGroup,
  type TriageInstanceInput,
} from '../../../lib/failure-grouping'
import { WORKFLOW_ATTENTION_OUTCOMES } from '../../../lib/run-outcome'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

/** Platform list cap. */
export const FAILURE_QUEUE_PAGE_SIZE_MAX = 100

/**
 * How many rows the error grouping scans. Grouping normalizes each message in
 * JS, so it cannot be a SQL `GROUP BY`; the response reports `scannedCount` and
 * `groupsTruncated` rather than pretending the groups cover everything.
 */
export const FAILURE_GROUP_SCAN_LIMIT = 500

function parsePositiveInt(rawValue: string | null, fallback: number): number {
  if (rawValue === null) return fallback
  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toTriageInput(instance: WorkflowInstance): TriageInstanceInput {
  return {
    id: instance.id,
    workflowId: instance.workflowId,
    status: instance.status,
    errorMessage: instance.errorMessage ?? null,
    attentionReason: instance.metadata?.attention?.reason ?? null,
    outcome: instance.outcome ?? null,
  }
}

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

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    const errorGroup = searchParams.get('errorGroup')
    const requestedLimit = parsePositiveInt(searchParams.get('limit'), 50)
    const limit = Math.min(Math.max(requestedLimit, 1), FAILURE_QUEUE_PAGE_SIZE_MAX)
    const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0)

    const attentionPath = raw(`(metadata #>> '{attention,reason}')`)
    const where: Record<string, unknown> = {
      tenantId,
      ...orgFilter.where,
      // A simulation that "failed" is a report about a definition, never a run
      // an operator must triage — and replaying one from here would start a
      // REAL instance from a dry-run's context. The run list has excluded dry
      // runs by default since spec §8.2; this union missed the same filter.
      isDryRun: false,
      // A `partial_failure` reached END and was written COMPLETED, so neither
      // the status arm nor the attention arm reaches it — and a run nobody
      // looks at because it said COMPLETED is exactly the failure the outcome
      // verdict exists to remove. Third arm, same union.
      $or: [
        { status: 'FAILED' },
        { outcome: { $in: [...WORKFLOW_ATTENTION_OUTCOMES] } },
        { [attentionPath]: { $ne: null } },
      ],
    }
    if (workflowId) where.workflowId = workflowId

    // Grouping first, over a bounded scan, so the group counts describe the
    // same set the caller is paging through.
    const scanned = (await em.find(WorkflowInstance, where, {
      orderBy: { createdAt: 'DESC' },
      limit: FAILURE_GROUP_SCAN_LIMIT,
    })) as WorkflowInstance[]
    const scannedInputs = scanned.map(toTriageInput)
    const groups = groupFailures(scannedInputs)

    let rows = scanned
    if (errorGroup) {
      rows = scanned.filter((instance) => matchesFailureGroup(toTriageInput(instance), errorGroup))
    }

    const total = errorGroup
      ? rows.length
      : await em.count(WorkflowInstance, where)

    return NextResponse.json({
      data: rows.slice(offset, offset + limit),
      groups,
      grouping: {
        scannedCount: scanned.length,
        scanLimit: FAILURE_GROUP_SCAN_LIMIT,
        truncated: scanned.length >= FAILURE_GROUP_SCAN_LIMIT,
      },
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    logger.error('Error listing the workflow failure queue', { err: error })
    return NextResponse.json({ error: 'Failed to list the workflow failure queue' }, { status: 500 })
  }
}

export const failureGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  workflowIds: z.array(z.string()),
  instanceIds: z.array(z.string().uuid()),
})

export const openApi = {
  methods: {
    GET: {
      summary: 'List the workflow failure queue',
      description:
        'Triage list of instances parked by a failure-queue error directive together with FAILED instances, plus normalized error groups so a batch of similar failures reads as one row.',
      tags: ['Workflows'],
      query: z.object({
        workflowId: z.string().optional(),
        errorGroup: z.string().optional().describe('Narrow the list to one normalized error group key.'),
        limit: z.number().int().positive().max(FAILURE_QUEUE_PAGE_SIZE_MAX).default(50).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'Failure queue',
          schema: z.object({
            data: z.array(workflowInstanceResponseSchema),
            groups: z.array(failureGroupSchema),
            grouping: z.object({
              scannedCount: z.number().int().nonnegative(),
              scanLimit: z.number().int().positive(),
              truncated: z.boolean(),
            }),
            pagination: paginationSchema,
          }),
        },
        {
          status: 401,
          description: 'Unauthorized',
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
