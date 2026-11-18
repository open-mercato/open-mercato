import { NextResponse } from 'next/server'
import { raw } from '@mikro-orm/core'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Unavailability } from '../../data/entities'
import {
  UNAVAILABILITY_SUBJECT_TYPES,
  unavailabilityCreateBodySchema,
  unavailabilityCreateSchema,
  unavailabilityPreviewSchema,
} from '../../data/validators'
import { NO_MATCH_ID } from '../../lib/buildingAccess'
import { effectiveEnd, notOverAt } from '../../lib/availabilityResolver'
import { loadReasonLabels } from '../../lib/unavailabilityReasons'
import { resolveCrmAccess } from '../../lib/crmAccess'
import { compareWallClock, localNow, normalizeWallClock } from '../../lib/wallClock'
import {
  previewUnavailability,
  UNAVAILABILITY_RESOURCE_KIND,
  type UnavailabilityCreateResult,
} from '../../commands/availability'
import { guardedCommandInput, handleRouteError, resolveStaffContext, runStaffGuard } from '../routeContext'
import { crmAccessSchema } from '../crudShared'
import { translateZodFieldErrors } from '../../lib/zodFieldErrors'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.availability.manage'] },
}

const MAX_IDS = 100
const LIST_LIMIT = 500
function hasWindowCondition() {
  return raw('(least("ends_at", "ended_at") is null or least("ends_at", "ended_at") > "starts_at")')
}

const idList = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').map((part) => part.trim()).filter(Boolean) : []))
  .pipe(z.array(z.string().uuid()).max(MAX_IDS))

const listQuerySchema = z.object({
  buildingIds: idList,
  subjectIds: idList,
  subjectType: z.enum(UNAVAILABILITY_SUBJECT_TYPES).optional(),
  active: z.enum(['true', 'false']).default('true'),
})

const createQuerySchema = z.object({ dryRun: z.enum(['true', 'false']).default('false') })

const itemSchema = z.object({
  id: z.string().uuid(),
  buildingId: z.string().uuid(),
  subjectType: z.enum(UNAVAILABILITY_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  reasonEntryId: z.string().uuid().nullable(),
  reasonLabel: z.string().nullable(),
  reasonText: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  effectiveEndsAt: z.string().nullable(),
  inEffect: z.boolean(),
  applyStatus: z.enum(['applied', 'applying']),
  cancelledBookingCount: z.number().int(),
  updatedAt: z.string(),
})

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const query = listQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const permitted = context.permitted
    const requestedBuildings = query.buildingIds.length ? query.buildingIds : null
    const allowedBuildings = permitted === null ? requestedBuildings : (requestedBuildings ?? permitted).filter((id) => permitted.includes(id))
    const now = localNow()
    const listWhere = (): Record<string, unknown> => {
      const where: Record<string, unknown> = { ...scope, deletedAt: null }
      if (allowedBuildings !== null) where.buildingId = { $in: allowedBuildings.length ? allowedBuildings : [NO_MATCH_ID] }
      if (query.subjectIds.length) where.subjectId = { $in: query.subjectIds }
      if (query.subjectType) where.subjectType = query.subjectType
      if (query.active === 'true') Object.assign(where, { $and: notOverAt(now), [hasWindowCondition()]: true })
      return where
    }
    const fetched = await findWithDecryption(context.em, Unavailability, listWhere(), { orderBy: { startsAt: 'asc' }, limit: LIST_LIMIT + 1 }, scope)
    const truncated = fetched.length > LIST_LIMIT
    const visible = truncated ? fetched.slice(0, LIST_LIMIT) : fetched
    const labels = await loadReasonLabels(context.em, scope, visible.map((row) => row.reasonEntryId ?? '').filter(Boolean))
    return NextResponse.json({
      items: visible.map((row) => {
        const end = effectiveEnd(row)
        const startsAt = normalizeWallClock(row.startsAt)
        return {
          id: row.id,
          buildingId: row.buildingId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          reasonEntryId: row.reasonEntryId ?? null,
          reasonLabel: row.reasonEntryId ? labels.get(row.reasonEntryId) ?? null : null,
          reasonText: row.reasonText,
          startsAt,
          endsAt: row.endsAt ? normalizeWallClock(row.endsAt) : null,
          endedAt: row.endedAt ? normalizeWallClock(row.endedAt) : null,
          effectiveEndsAt: end,
          inEffect: compareWallClock(startsAt, now) <= 0 && (end === null || compareWallClock(end, now) > 0),
          applyStatus: row.applyStatus,
          cancelledBookingCount: row.cancelledBookingCount,
          updatedAt: row.updatedAt.toISOString(),
        }
      }),
      total: truncated ? await context.em.count(Unavailability, listWhere()) : visible.length,
      truncated,
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.unavailabilities_list_failed')
  }
}

function invalidInput(err: z.ZodError, translate: (key: string, fallback?: string) => string): Response {
  return NextResponse.json(
    { error: translate('property_management.errors.invalidInput', 'Invalid input'), fieldErrors: translateZodFieldErrors(err, translate) },
    { status: 422 },
  )
}

export async function POST(req: Request) {
  let translate: ((key: string, fallback?: string) => string) | null = null
  try {
    const context = await resolveStaffContext(req)
    translate = context.translate
    const { dryRun } = createQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const body = unavailabilityCreateBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    if (dryRun === 'true') {
      const input = unavailabilityPreviewSchema.parse({ ...body, ...scope })
      const crmAccess = await resolveCrmAccess(context.ctx.container, context.ctx.auth ?? null, scope)
      return NextResponse.json(await previewUnavailability(context.em, scope, context.permitted, input, crmAccess))
    }
    const input = unavailabilityCreateSchema.parse({ ...body, ...scope })
    const guarded = await runStaffGuard(req, context, { resourceKind: UNAVAILABILITY_RESOURCE_KIND, operation: 'create', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(unavailabilityCreateSchema, guarded, input, scope)
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, UnavailabilityCreateResult>('property_management.unavailability.create', {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json(
      {
        id: result.unavailabilityId,
        cancelledBookings: result.cancelledBookings,
        queuedBookings: result.queuedBookings,
        flaggedLeases: result.flaggedLeases,
        applyStatus: result.applyStatus,
        progressJobId: result.progressJobId,
      },
      { status: 201 },
    )
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (err instanceof z.ZodError && translate) return invalidInput(err, translate)
    return handleRouteError(err, 'property_management.unavailability_create_failed')
  }
}

const previewSchema = z.object({
  subject: z.object({ type: z.enum(UNAVAILABILITY_SUBJECT_TYPES), id: z.string().uuid(), name: z.string() }),
  units: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  unitCount: z.number().int(),
  bookingsToCancel: z.array(
    z.object({
      id: z.string().uuid(),
      unitId: z.string().uuid(),
      unit: z.string().nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      person: z.string().nullable().optional().describe('Name of the person booking; present only with `customers.people.view`'),
    }),
  ),
  bookingCount: z.number().int(),
  leasesToFlag: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      company: z.string().nullable().optional().describe('Name of the tenant company; present only with `customers.companies.view`'),
      unit: z.string().nullable(),
      startsOn: z.string(),
      endsOn: z.string(),
    }),
  ),
  leaseCount: z.number().int(),
  previewToken: z.string(),
  crmAccess: crmAccessSchema,
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Unavailability of buildings, floors, spaces and units',
  methods: {
    GET: {
      summary: 'Unavailabilities in the caller’s buildings',
      description:
        'Filter by `buildingIds` and/or `subjectIds` (comma-separated, at most 100) and `subjectType`. `active=true` (default) returns only periods that have not ended. Times are building-local wall-clock (`YYYY-MM-DDTHH:mm`). At most 500 rows are returned, ordered by `startsAt`; the list is not paginated. `truncated` is true when more periods match than were returned, and `total` then counts every matching period.',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Unavailabilities', schema: z.object({ items: z.array(itemSchema), total: z.number().int(), truncated: z.boolean() }) }],
    },
    POST: {
      summary: 'Preview (`dryRun=true`) or confirm making a subject unavailable',
      description:
        'The dry run lists the bookings it cancels and the leases it flags (each capped at 100, with totals) and returns a `previewToken` (hash of the affected booking ids). CRM names are gated on the customers features: `bookingsToCancel[].person` is present only with `customers.people.view` and `leasesToFlag[].company` only with `customers.companies.view`; otherwise those keys are omitted (the ids stay) and no CRM record is read. `crmAccess` tells the caller which of the two it has. Confirm sends the token; if the affected bookings changed meanwhile → `409 preview_stale`. Confirm takes the building → floor(s) → unit locks, cancels up to 200 bookings at once and queues the rest to the `unavailability_apply` worker with a progress job.',
      query: createQuerySchema,
      requestBody: { contentType: 'application/json', schema: unavailabilityCreateBodySchema },
      responses: [
        { status: 200, description: 'Dry run', schema: previewSchema },
        {
          status: 201,
          description: 'Unavailability created',
          schema: z.object({
            id: z.string().uuid(),
            cancelledBookings: z.number().int(),
            queuedBookings: z.number().int(),
            flaggedLeases: z.number().int(),
            applyStatus: z.enum(['applied', 'applying']),
            progressJobId: z.string().uuid().nullable(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Subject not found or its building is not assigned to the caller' },
        { status: 409, description: 'preview_stale, or subject_archived' },
        { status: 422, description: 'Invalid input, preview_token_required, unavailability_in_past, unavailability_start_in_past, unavailability_reason_invalid, cancelled_status_missing' },
      ],
    },
  },
}
