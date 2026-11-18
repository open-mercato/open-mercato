import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { E } from '#generated/entities.ids.generated'
import { Booking, Unit } from '../../data/entities'
import { BOOKING_STATUSES, bookingCreateBodySchema, bookingCreateSchema } from '../../data/validators'
import { summarizeBookings } from '../../lib/bookingView'
import { NO_MATCH_ID } from '../../lib/buildingAccess'
import { hasSalesFeature, SALES_ORDERS_VIEW_FEATURE } from '../../lib/creditPermission'
import { NO_CRM_ACCESS, resolveCrmAccess } from '../../lib/crmAccess'
import { isIsoDate } from '../../lib/leaseTerm'
import { endOfDay, startOfDay, toStoredWallClock } from '../../lib/wallClock'
import { BOOKING_RESOURCE_KIND, type BookingCreateResult } from '../../commands/booking'
import {
  asRecord,
  attachCrmAccess,
  createPagedListResponseSchema,
  crmAccessSchema,
  createPropertyManagementCrudOpenApi,
  crudEm,
  crudPermitted,
  crudScopeFilters,
  sealListScope,
  crudScope,
  listItems,
  listQueryBase,
  readIso,
  readNumber,
  readString,
  restrictBuildingField,
} from '../crudShared'
import { guardedCommandInput, handleRouteError, resolveStaffContext, runStaffGuard } from '../routeContext'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.bookings.manage'] },
}

export const metadata = routeMetadata

const SEARCH_UNIT_LIMIT = 200

const listSchema = z
  .object({
    ...listQueryBase,
    status: z.string().optional(),
    buildingId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    customerUserId: z.string().uuid().optional(),
    date: z.string().refine(isIsoDate).optional(),
  })
  .passthrough()

function parseStatuses(raw: string | undefined): string[] {
  if (!raw) return []
  const allowed = new Set<string>(BOOKING_STATUSES)
  return raw.split(',').map((value) => value.trim()).filter((value) => allowed.has(value))
}

function readWallClock(row: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readString(row, ...keys)
  return value ? value.replace(' ', 'T').slice(0, 16) : null
}

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    status: readString(row, 'status'),
    buildingId: readString(row, 'building_id', 'buildingId'),
    unitId: readString(row, 'unit_id', 'unitId'),
    bookedByPersonId: readString(row, 'booked_by_person_id', 'bookedByPersonId'),
    customerCompanyId: readString(row, 'customer_company_id', 'customerCompanyId'),
    customerUserId: readString(row, 'customer_user_id', 'customerUserId'),
    startsAt: readWallClock(row, 'starts_at', 'startsAt'),
    endsAt: readWallClock(row, 'ends_at', 'endsAt'),
    catalogProductId: readString(row, 'catalog_product_id', 'catalogProductId'),
    productName: readString(row, 'product_name', 'productName'),
    unitPrice: readString(row, 'unit_price', 'unitPrice'),
    quantity: readNumber(row, 'quantity'),
    billingUnit: readString(row, 'billing_unit', 'billingUnit'),
    totalAmount: readString(row, 'total_amount', 'totalAmount'),
    currencyCode: readString(row, 'currency_code', 'currencyCode'),
    cancelReason: readString(row, 'cancel_reason', 'cancelReason'),
    salesOrderId: readString(row, 'sales_order_id', 'salesOrderId'),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

async function searchFilter(ctx: CrudCtx, term: string, permitted: string[] | null): Promise<Record<string, unknown>[]> {
  const scope = crudScope(ctx)
  const pattern = `%${escapeLikePattern(term)}%`
  const clauses: Record<string, unknown>[] = [{ product_name: { $ilike: pattern } }]
  if (!scope) return clauses
  const where: Record<string, unknown> = { ...scope, deletedAt: null, name: { $ilike: pattern } }
  if (permitted !== null) where.buildingId = { $in: permitted.length ? permitted : [NO_MATCH_ID] }
  const units = await findWithDecryption(crudEm(ctx), Unit, where, { limit: SEARCH_UNIT_LIMIT, fields: ['id'] }, scope)
  if (units.length) clauses.push({ unit_id: { $in: units.map((unit) => unit.id) } })
  return clauses
}

async function decorateBookings(payload: unknown, ctx: CrudCtx): Promise<void> {
  const scope = crudScope(ctx)
  const crmAccess = scope ? await resolveCrmAccess(ctx.container, ctx.auth ?? null, scope) : NO_CRM_ACCESS
  attachCrmAccess(payload, crmAccess)
  const items = listItems(payload)
  if (!scope || !items.length) return
  const em = crudEm(ctx)
  const canViewOrders = await hasSalesFeature(ctx.container, ctx.auth, scope, SALES_ORDERS_VIEW_FEATURE)
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const bookings = await findWithDecryption(em, Booking, { ...scope, id: { $in: ids } }, undefined, scope)
  const summaries = new Map((await summarizeBookings(em, scope, bookings, { crmAccess, salesOrderNumbers: canViewOrders })).map((summary) => [summary.id, summary]))
  for (const item of items) {
    const summary = summaries.get(readString(item, 'id') ?? '')
    if (summary) Object.assign(item, summary)
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: Booking, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: E.property_management.booking },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.property_management.booking,
    fields: [
      'id',
      'status',
      'building_id',
      'unit_id',
      'booked_by_person_id',
      'customer_company_id',
      'customer_user_id',
      'starts_at',
      'ends_at',
      'catalog_product_id',
      'product_name',
      'unit_price',
      'quantity',
      'billing_unit',
      'total_amount',
      'currency_code',
      'cancel_reason',
      'sales_order_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: { startsAt: 'starts_at', status: 'status', updatedAt: 'updated_at', createdAt: 'created_at' },
    defaultSort: { field: 'starts_at', dir: 'desc' },
    tiebreakSortField: 'id',
    omitAutomaticTenantOrgScope: true,
    buildFilters: async (query, ctx) => {
      const scope = crudScopeFilters(ctx)
      const permitted = await crudPermitted(ctx)
      restrictBuildingField(scope, 'building_id', permitted, query.buildingId)
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.unitId) filters.unit_id = { $eq: query.unitId }
      if (query.customerUserId) filters.customer_user_id = { $eq: query.customerUserId }
      const statuses = parseStatuses(query.status)
      if (statuses.length) filters.status = { $in: statuses }
      if (query.date) {
        filters.starts_at = { $lt: toStoredWallClock(endOfDay(query.date)) }
        filters.ends_at = { $gt: toStoredWallClock(startOfDay(query.date)) }
      }
      const term = query.search?.trim()
      if (term) filters.$or = await searchFilter(ctx, term, permitted)
      return sealListScope(scope, filters)
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  hooks: { afterList: decorateBookings },
})

export const GET = crud.GET

export async function POST(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const body = bookingCreateBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = bookingCreateSchema.parse({ ...body, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, { resourceKind: BOOKING_RESOURCE_KIND, operation: 'create', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(bookingCreateSchema, guarded, input, { tenantId: context.tenantId, organizationId: context.organizationId })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, BookingCreateResult>('property_management.booking.create', {
      input: commandInput,
      ctx: context.ctx,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json({ id: result.bookingId, status: result.status, operationId: result.operationId }, { status: 202 })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.booking_create_failed')
  }
}

const bookingItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(BOOKING_STATUSES),
  buildingId: z.string().uuid(),
  buildingName: z.string().nullable(),
  unitId: z.string().uuid(),
  unitName: z.string().nullable(),
  floorName: z.string().nullable(),
  bookedByPersonId: z.string().uuid(),
  bookedByName: z.string().nullable().optional().describe('Present only with `customers.people.view`; `bookedByPersonId` is always returned'),
  customerCompanyId: z.string().uuid().nullable(),
  companyName: z.string().nullable().optional().describe('Present only with `customers.companies.view`; `customerCompanyId` is always returned'),
  customerUserId: z.string().uuid().nullable(),
  startsAt: z.string().describe('Building-local wall-clock time, YYYY-MM-DDTHH:mm'),
  endsAt: z.string().describe('Building-local wall-clock time, YYYY-MM-DDTHH:mm'),
  catalogProductId: z.string().uuid(),
  productName: z.string(),
  unitPrice: z.string(),
  quantity: z.number().int(),
  billingUnit: z.enum(['hour', 'day']),
  totalAmount: z.string(),
  currencyCode: z.string().nullable(),
  cancelReason: z.string().nullable(),
  salesOrderId: z.string().uuid().nullable(),
  salesOrderNumber: z.string().nullable().describe('Null unless the caller has `sales.orders.view`; `salesOrderId` is always returned'),
  salesOrderCancelled: z.boolean(),
  cancellable: z.boolean().describe('True when a manager may cancel the booking now: it is pending or confirmed and its end is still ahead of the deployment-local clock (the same rule that otherwise returns 409 `booking_already_ended`)'),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Booking',
  description:
    'Returns a paginated collection of bookings in the buildings the caller may see. CRM names are gated on the customers features: `bookedByName` is present only with `customers.people.view` and `companyName` only with `customers.companies.view`; otherwise those keys are omitted (the ids stay) and no CRM record is read. The top-level `crmAccess` tells the caller which of the two it has. `salesOrderNumber` is null unless the caller has `sales.orders.view`. Each row carries `cancellable`, computed with the deployment-local clock, so clients need not compare times themselves.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(bookingItemSchema).extend({ crmAccess: crmAccessSchema }),
  create: {
    schema: bookingCreateBodySchema,
    status: 202,
    responseSchema: z.object({ id: z.string().uuid(), status: z.literal('pending'), operationId: z.string().uuid() }),
    description:
      'Books a bookable unit on behalf of a customer. Times are building-local wall-clock (`YYYY-MM-DDTHH:mm`, no zone). The slot is held at once (`pending`); the booking becomes `confirmed` once its sales order exists. 409 `booking_slot_taken`, `unit_leased`, `location_unavailable`, `booking_outside_opening_hours`; 422 `billing_channel_missing`, `cancelled_status_missing`, `unit_not_bookable`, booking rule violations or references outside the organization.',
  },
})
