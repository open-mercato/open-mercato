/**
 * Per-definition operational KPIs (spec §8.5).
 *
 * Endpoint:
 * - GET /api/workflows/metrics/definitions?window=7d&workflowIds=a,b,c
 *
 * Batch by design: the caller is a definitions list asking about the rows it
 * currently has on screen, which is one request rather than one per row. This
 * mirrors `agent_orchestrator`'s `/api/agent_orchestrator/metrics/agents?ids=`
 * batch route, including its rollup-preferred / live-fallback rule.
 *
 * **Rollup or live, never a lie about which.** A stored row is used only when it
 * covers the requested window, is fresher than `ROLLUP_FRESHNESS_MS`, and still
 * parses against `workflowDefinitionMetricsSchema`; otherwise the window is
 * recomputed from the source rows through the SAME function the worker uses.
 * Every item reports `source` so a reader can tell a 15-minute-old aggregate
 * from a live one, and `computedAt` so they can tell how old.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowDefinitionMetricRollup } from '../../../data/entities'
import {
  workflowDefinitionMetricsQuerySchema,
  workflowDefinitionMetricsSchema,
  type WorkflowDefinitionMetricsPayload,
} from '../../../data/metrics-validators'
import {
  WORKFLOW_ROLLUP_BUCKET_MS,
  WORKFLOW_ROLLUP_WINDOW_KEYS,
  WORKFLOW_ROLLUP_WINDOW_MS,
  floorToRollupBucket,
  type WorkflowRollupWindowKey,
} from '../../../lib/metrics/definition-metrics'
import {
  computeDefinitionMetrics,
  type MetricsReadScope,
} from '../../../lib/metrics/rollup-service'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.metrics.view'],
}

/**
 * How many definitions one request may ask about. Well under the platform's
 * page-size ceiling of 100 because each miss costs a live recompute, and a page
 * of 50 rows is already the largest list this module renders.
 */
export const WORKFLOW_METRICS_MAX_IDS = 50

/**
 * A rollup older than two bucket ticks is treated as stale and recomputed. Two
 * rather than one so a single missed scheduler tick degrades to a slightly old
 * number instead of to a full live recompute for every row on the page.
 */
export const ROLLUP_FRESHNESS_MS = 2 * WORKFLOW_ROLLUP_BUCKET_MS

type MetricsItem = {
  workflowId: string
  window: WorkflowRollupWindowKey
  windowStart: string
  windowEnd: string
  computedAt: string
  source: 'rollup' | 'live'
  /**
   * The VALIDATED payload, not `DefinitionMetrics`: a rollup row written before
   * a metric existed simply lacks that key, and the reader must see it absent
   * rather than have a zero invented for it here. A live compute always carries
   * every key, and is assignable to this wider shape.
   */
  metrics: WorkflowDefinitionMetricsPayload
}

function parseWorkflowIds(rawValue: string): string[] {
  return Array.from(
    new Set(
      rawValue
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  )
}

export async function GET(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const orgFilter = resolveOrganizationScopeFilter(orgScope, auth)
    const readScope: MetricsReadScope = {
      tenantId,
      organizationIds: orgFilter.organizationIds,
    }
    // A stored rollup row is per-organization, so it can answer only a
    // single-organization read. A multi-organization or tenant-wide scope is
    // live-computed instead: counts would sum, but a percentile cannot be
    // recovered from several stored percentiles, and a KPI that is right about
    // three numbers and wrong about the fourth is worse than a slower one.
    const singleOrganizationId =
      orgFilter.organizationIds?.length === 1 ? orgFilter.organizationIds[0] : null

    const { searchParams } = new URL(request.url)
    const parsed = workflowDefinitionMetricsQuerySchema.safeParse({
      window: searchParams.get('window') ?? undefined,
      workflowIds: searchParams.get('workflowIds') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const windowKey = parsed.data.window as WorkflowRollupWindowKey
    const workflowIds = parseWorkflowIds(parsed.data.workflowIds)
    if (workflowIds.length === 0) {
      return NextResponse.json({ error: 'workflowIds must name at least one workflow' }, { status: 400 })
    }
    if (workflowIds.length > WORKFLOW_METRICS_MAX_IDS) {
      return NextResponse.json(
        { error: `workflowIds accepts at most ${WORKFLOW_METRICS_MAX_IDS} ids` },
        { status: 400 },
      )
    }

    const now = new Date()
    const windowEndMs = floorToRollupBucket(now.getTime())
    const windowEnd = new Date(windowEndMs)
    const windowStart = new Date(windowEndMs - WORKFLOW_ROLLUP_WINDOW_MS[windowKey])

    const freshestByWorkflowId = new Map<string, WorkflowDefinitionMetricRollup>()
    if (singleOrganizationId) {
      const storedRows = await em.find(
        WorkflowDefinitionMetricRollup,
        {
          tenantId,
          organizationId: singleOrganizationId,
          workflowId: { $in: workflowIds },
          windowKey,
        },
        { orderBy: { computedAt: 'DESC' } },
      )
      for (const row of storedRows) {
        if (!freshestByWorkflowId.has(row.workflowId)) freshestByWorkflowId.set(row.workflowId, row)
      }
    }

    const data: MetricsItem[] = []
    for (const workflowId of workflowIds) {
      const stored = freshestByWorkflowId.get(workflowId)
      const isFresh = stored ? now.getTime() - stored.computedAt.getTime() <= ROLLUP_FRESHNESS_MS : false
      const validated = stored && isFresh ? workflowDefinitionMetricsSchema.safeParse(stored.metrics) : null

      if (stored && validated?.success) {
        data.push({
          workflowId,
          window: windowKey,
          windowStart: stored.windowStart.toISOString(),
          windowEnd: stored.windowEnd.toISOString(),
          computedAt: stored.computedAt.toISOString(),
          source: 'rollup',
          metrics: validated.data,
        })
        continue
      }

      const metrics = await computeDefinitionMetrics(em, readScope, {
        workflowId,
        windowStart,
        windowEnd,
      })
      data.push({
        workflowId,
        window: windowKey,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        computedAt: now.toISOString(),
        source: 'live',
        metrics,
      })
    }

    return NextResponse.json({ data })
  } catch (error) {
    logger.error('Error reading workflow definition metrics', { err: error })
    return NextResponse.json({ error: 'Failed to read workflow definition metrics' }, { status: 500 })
  }
}

const metricsItemSchema = z.object({
  workflowId: z.string(),
  window: z.enum(WORKFLOW_ROLLUP_WINDOW_KEYS as [string, ...string[]]),
  windowStart: z.string(),
  windowEnd: z.string(),
  computedAt: z.string(),
  source: z.enum(['rollup', 'live']),
  metrics: workflowDefinitionMetricsSchema,
})

export const openApi = {
  methods: {
    GET: {
      summary: 'Read per-definition workflow operational KPIs',
      description:
        'Batch KPI read for the named workflow ids over a sliding window: runs started, terminal runs by outcome, success rate, run-duration p50/p95 and task SLA hit-rate. Dry runs are excluded from every figure. Served from the precomputed rollup when one is fresh, recomputed live otherwise; each item reports which.',
      tags: ['Workflows'],
      query: z.object({
        window: z
          .enum(WORKFLOW_ROLLUP_WINDOW_KEYS as [string, ...string[]])
          .default('7d')
          .optional()
          .describe('Sliding window length.'),
        workflowIds: z
          .string()
          .describe(
            `Comma-separated logical workflow ids, at most ${WORKFLOW_METRICS_MAX_IDS} per request.`,
          ),
      }),
      responses: [
        {
          status: 200,
          description: 'Per-definition metrics',
          schema: z.object({ data: z.array(metricsItemSchema) }),
        },
        {
          status: 400,
          description: 'Invalid query or missing tenant context',
          schema: z.object({ error: z.string() }),
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
