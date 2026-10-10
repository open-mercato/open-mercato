import { z } from 'zod'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { RentalVehicleCheck } from '../../data/entities'
import { recordRentalCheckSchema } from '../../data/validators'
import { executeRentalAction } from '../../lib/apiAction'
import { RENTAL_CHECK_ENTITY_ID } from '../../commands/entities'

export const metadata = {
  path: '/vehicle_rentals/checks',
  GET: { requireAuth: true, requireFeatures: ['rentals.read'] },
  POST: { requireAuth: true, requireFeatures: ['rentals.checks.manage'] },
}

const listSchema = z.object({
  contractId: z.string().uuid(),
})

/**
 * The check documents of one rental, oldest first: the handover and return
 * checks the lifecycle wrote, plus any inspection recorded in between. They are
 * read as a timeline on the rental detail.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })

    const url = new URL(req.url)
    const { contractId } = listSchema.parse({ contractId: url.searchParams.get('contractId') ?? '' })
    const em = (container.resolve('em') as EntityManager).fork()
    const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
      `select id, kind, odometer_km, fuel_level, has_damage, condition_notes, checked_at, checked_by
       from rental_vehicle_checks
       where tenant_id = ? and organization_id = ? and contract_id = ? and deleted_at is null
       order by checked_at asc`,
      [auth.tenantId, organizationId, contractId],
    )
    return NextResponse.json({
      items: rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        odometerKm: Number(row.odometer_km ?? 0),
        fuelLevel: row.fuel_level === null || row.fuel_level === undefined ? null : Number(row.fuel_level),
        hasDamage: Boolean(row.has_damage),
        conditionNotes: row.condition_notes === null || row.condition_notes === undefined ? null : String(row.condition_notes),
        checkedAt: row.checked_at instanceof Date ? row.checked_at.toISOString() : String(row.checked_at ?? ''),
        checkedBy: row.checked_by === null || row.checked_by === undefined ? null : String(row.checked_by),
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to load the vehicle checks.' }, { status: 400 })
  }
}

/** Records a standalone check (an inspection during the rental, or one added after the fact). */
export async function POST(req: Request): Promise<Response> {
  return executeRentalAction<{ checkId: string }>(req, {
    parse: (raw) => recordRentalCheckSchema.parse(raw),
    resourceKind: RENTAL_CHECK_ENTITY_ID,
    resourceId: (input) => String(input.contractId),
    commandId: 'vehicle_rentals.checks.record',
    errorMessageKey: 'check_failed',
    errorFallback: 'Unable to record the vehicle check.',
    toResponse: (result) => ({ checkId: result.checkId }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Vehicle Rentals',
  summary: 'Vehicle condition checks of a rental',
  methods: {
    GET: {
      summary: 'List the checks of one rental contract',
      responses: [{
        status: 200,
        description: 'Checks in chronological order',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            kind: z.enum(['handover', 'return']),
            odometerKm: z.number(),
            fuelLevel: z.number().nullable(),
            hasDamage: z.boolean(),
            conditionNotes: z.string().nullable(),
            checkedAt: z.string(),
            checkedBy: z.string().uuid().nullable(),
          })),
        }),
      }],
    },
    POST: {
      summary: 'Record a vehicle check for a rental',
      requestBody: { contentType: 'application/json', schema: recordRentalCheckSchema },
      responses: [{
        status: 200,
        description: 'Check recorded',
        schema: z.object({ ok: z.boolean(), checkId: z.string().uuid() }),
      }],
    },
  },
}
