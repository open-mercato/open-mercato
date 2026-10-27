/**
 * Workflow "Would do" report API (spec section 8.2)
 *
 * Endpoint:
 * - GET /api/workflows/instances/[id]/would-do - the ordered list of every side
 *   effect a dry run suppressed.
 *
 * The report is DERIVED, never stored twice: a dry run writes its would-do
 * entries as ordinary `WorkflowEvent` rows, so the report inherits the run
 * views' tenant scoping, ordering and retention instead of owning a second
 * table that could disagree with the run log.
 *
 * A real run answers `{ isDryRun: false, entries: [] }` rather than 404 — the
 * caller asks "what did this run suppress?" and "nothing, it was real" is a
 * correct answer, not a missing resource.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowInstance, WorkflowEvent, StepInstance } from '../../../../data/entities'
import { DRY_RUN_EVENT_TYPES, buildWouldDoReport, type WouldDoSourceEvent } from '../../../../lib/dry-run'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

/** Platform cap: no list surface pages above 100 rows. */
export const WOULD_DO_PAGE_SIZE_MAX = 100

const REPORTED_EVENT_TYPES = [
  DRY_RUN_EVENT_TYPES.activitySimulated,
  DRY_RUN_EVENT_TYPES.activityRefused,
  DRY_RUN_EVENT_TYPES.userTaskSimulated,
  DRY_RUN_EVENT_TYPES.businessRuleActionsSuppressed,
]

interface RouteContext {
  params: Promise<{ id: string }>
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

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

    if (!instance.isDryRun) {
      return NextResponse.json({
        isDryRun: false,
        entries: [],
        stoppedByRefusal: false,
        pagination: { total: 0, limit: 0, offset: 0, hasMore: false },
      })
    }

    const { searchParams } = new URL(request.url)
    const requestedLimit = parsePositiveInt(searchParams.get('limit'), WOULD_DO_PAGE_SIZE_MAX)
    const limit = Math.min(Math.max(requestedLimit, 1), WOULD_DO_PAGE_SIZE_MAX)
    const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0)

    const [events, total] = await em.findAndCount(
      WorkflowEvent,
      {
        workflowInstanceId: params.id,
        tenantId,
        ...orgFilter.where,
        eventType: { $in: REPORTED_EVENT_TYPES },
      },
      {
        // `id` breaks ties: two entries can share a millisecond, and a report
        // that reorders between two reads is not evidence.
        orderBy: [{ occurredAt: 'ASC' }, { id: 'ASC' }],
        limit,
        offset,
      }
    )

    // `WorkflowEvent` carries the step INSTANCE id; the report is read against
    // the canvas, which addresses steps by their definition `stepId`. Resolving
    // the handful of rows once here keeps the pure report builder free of the
    // ORM and stops every consumer re-deriving the same join.
    const stepInstanceIds = Array.from(
      new Set(
        events
          .map((event: WorkflowEvent) => event.stepInstanceId)
          .filter((id: string | null | undefined): id is string => !!id)
      )
    )
    const stepInstances = stepInstanceIds.length
      ? await em.find(StepInstance, {
          id: { $in: stepInstanceIds },
          tenantId,
          ...orgFilter.where,
        })
      : []
    const stepIdByInstanceId = new Map<string, string>(
      stepInstances.map((step: StepInstance) => [step.id, step.stepId])
    )

    const sourceEvents: WouldDoSourceEvent[] = events.map((event: WorkflowEvent) => ({
      // `WorkflowEvent.id` is a `bigint` column, and MikroORM v7's `BigIntType`
      // hydrates it as a native JS `bigint` (its default mode) despite the
      // `string` annotation. Lifting it out of the entity into a plain object
      // bypasses the ORM serializer that would have stringified it, so
      // `NextResponse.json` would throw "Do not know how to serialize a BigInt"
      // and the catch below would report it as a generic 500. Same fix as
      // `api/events/route.ts`.
      id: String(event.id),
      eventType: event.eventType,
      stepId: event.stepInstanceId ? stepIdByInstanceId.get(event.stepInstanceId) ?? null : null,
      occurredAt: event.occurredAt,
      eventData: (event.eventData ?? null) as Record<string, unknown> | null,
    }))

    const report = buildWouldDoReport(sourceEvents)

    return NextResponse.json({
      isDryRun: true,
      entries: report.entries,
      stoppedByRefusal: report.stoppedByRefusal,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    logger.error('Error building workflow would-do report', { err: error })
    return NextResponse.json({ error: 'Failed to build would-do report' }, { status: 500 })
  }
}

const wouldDoEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['activity', 'refusal', 'userTask', 'businessRule']),
  severity: z.enum(['error', 'warning', 'info']),
  stepId: z.string().nullable(),
  occurredAt: z.string(),
  subject: z.string(),
  detail: z.record(z.string(), z.unknown()),
})

export const openApi = {
  methods: {
    GET: {
      summary: 'Get a dry run\'s "Would do" report',
      description:
        'List every side effect a dry run suppressed, in execution order: simulated activities with their would-do output, activity types that refused simulation and stopped the run, user tasks that were not raised, and business rules whose action arm was withheld. A real (non-dry) run answers with an empty report.',
      tags: ['Workflows'],
      params: z.object({ id: z.string().uuid() }),
      query: z.object({
        limit: z.number().int().positive().max(WOULD_DO_PAGE_SIZE_MAX).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'The would-do report',
          schema: z.object({
            isDryRun: z.boolean(),
            entries: z.array(wouldDoEntrySchema),
            stoppedByRefusal: z.boolean(),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            }),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Workflow instance not found', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Internal server error', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
