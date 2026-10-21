import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createVehicleSchema, updateVehicleSchema } from '../../data/validators'
import { createFleetCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { runFleetAction } from '../action'
import '../../commands/fleet'

const logger = createLogger('fleet_management')

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  status: z.enum(['active', 'assigned', 'maintenance', 'out_of_service']).optional(),
  assignedEmployeeId: z.string().uuid().optional(),
  plateNumber: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
  POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
  PUT: { requireAuth: true, requireFeatures: ['fleet.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['fleet.write'] },
}

export const metadata = { path: '/fleet_management/vehicles', ...routeMetadata }

const SORT_FIELDS: Record<string, string> = {
  plateNumber: 'plate_number',
  plate_number: 'plate_number',
  make: 'make',
  model: 'model',
  year: 'year',
  currentOdometer: 'current_odometer',
  current_odometer: 'current_odometer',
  status: 'status',
  createdAt: 'created_at',
  created_at: 'created_at',
  updatedAt: 'updated_at',
  updated_at: 'updated_at',
}

const ACTIVE_ASSIGNMENT = `(
  select a.employee_id
  from fleet_vehicle_assignments a
  where a.vehicle_id = tv.id and a.tenant_id = tv.tenant_id and a.organization_id = tv.organization_id
    and a.deleted_at is null and a.status in ('pending_approval', 'active')
  order by a.created_at desc
  limit 1
)`

function isMissingRelationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('42P01') || /relation .* does not exist/i.test(message)
}

function readCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    }

    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 25) || 25))
    const id = url.searchParams.get('id')
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
    const status = url.searchParams.get('status')
    const assignedEmployeeId = url.searchParams.get('assignedEmployeeId')
    const plateNumber = url.searchParams.get('plateNumber')
    const sortField = SORT_FIELDS[url.searchParams.get('sortField') ?? ''] ?? 'plate_number'
    const sortDir = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'

    const vehicleConditions = ['tv.tenant_id = ?', 'tv.organization_id = ?', 'tv.deleted_at is null']
    const vehicleParams: unknown[] = [auth.tenantId, organizationId]
    if (id) {
      vehicleConditions.push('tv.id = ?')
      vehicleParams.push(id)
    }
    if (ids.length > 0) {
      vehicleConditions.push(`tv.id in (${ids.map(() => '?').join(', ')})`)
      vehicleParams.push(...ids)
    }

    const rowsCte = `with fleet_rows as (
      select tv.id, tv.tenant_id, tv.organization_id, tv.plate_number, tv.sequence_number,
             tv.make, tv.model, tv.year, tv.color, tv.vehicle_type, tv.current_odometer,
             tv.notes, tv.created_at, tv.updated_at,
             ${ACTIVE_ASSIGNMENT} as assigned_employee_id,
             case
               when tv.status = 'maintenance' then 'maintenance'
               when tv.status = 'out_of_service' then 'out_of_service'
               when ${ACTIVE_ASSIGNMENT} is not null then 'assigned'
               else 'active'
             end as status
      from transport_vehicles tv
      where ${vehicleConditions.join(' and ')}
    )`

    const filterConditions: string[] = ['1 = 1']
    const filterParams: unknown[] = []
    if (status) {
      filterConditions.push('status = ?')
      filterParams.push(status)
    }
    if (assignedEmployeeId) {
      filterConditions.push('assigned_employee_id = ?')
      filterParams.push(assignedEmployeeId)
    }
    if (plateNumber && plateNumber.trim().length > 0) {
      filterConditions.push('plate_number ilike ?')
      filterParams.push(`%${escapeLikePattern(plateNumber.trim())}%`)
    }
    const whereClause = filterConditions.join(' and ')

    const em = (container.resolve('em') as EntityManager).fork()
    const countRows = await em.getConnection().execute<Array<{ count: unknown }>>(
      `${rowsCte} select count(*)::int as count from fleet_rows where ${whereClause}`,
      [...vehicleParams, ...filterParams],
    )
    const rows = await em.getConnection().execute<Record<string, unknown>[]>(
      `${rowsCte} select * from fleet_rows where ${whereClause}
       order by ${sortField} ${sortDir} nulls last
       limit ? offset ?`,
      [...vehicleParams, ...filterParams, pageSize, (page - 1) * pageSize],
    )
    const total = readCount(countRows[0]?.count)
    return NextResponse.json({
      items: rows.map((row) => ({ ...row, updatedAt: row.updated_at ?? null })),
      total,
      page,
      pageSize,
      totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (isMissingRelationError(err)) {
      return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })
    }
    const { translate } = await resolveTranslations()
    logger.error('fleet_management.vehicles.list.failed', { err })
    return NextResponse.json(
      { error: translate('fleet_management.vehicles.error.load', 'Could not load vehicles.') },
      { status: 400 },
    )
  }
}

export async function POST(req: Request) {
  return runFleetAction({
    req,
    schema: createVehicleSchema,
    commandId: 'fleet_management.vehicles.create',
    operation: 'create',
    resolveResourceId: () => '',
    fallbackError: 'Unable to create the vehicle',
    status: 201,
  })
}

export async function PUT(req: Request) {
  return runFleetAction({
    req,
    schema: updateVehicleSchema,
    commandId: 'fleet_management.vehicles.update',
    operation: 'update',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to update the vehicle',
  })
}

export async function DELETE(req: Request) {
  return runFleetAction({
    req,
    schema: z.object({ id: z.string().uuid() }),
    commandId: 'fleet_management.vehicles.delete',
    operation: 'delete',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to delete the vehicle',
  })
}

const vehicleListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  plate_number: z.string(), sequence_number: z.string().nullable().optional(),
  make: z.string(), model: z.string(), year: z.number(),
  color: z.string().nullable().optional(), vehicle_type: z.string().nullable().optional(),
  status: z.enum(['active', 'assigned', 'maintenance', 'out_of_service']),
  current_odometer: z.number(), assigned_employee_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createFleetCrudOpenApi({
  resourceName: 'Vehicle', pluralName: 'Vehicles', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(vehicleListItemSchema),
  create: { schema: createVehicleSchema, description: 'Creates a vehicle in the transport register.' },
  update: { schema: updateVehicleSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a vehicle in the transport register.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a vehicle in the transport register.' },
})
