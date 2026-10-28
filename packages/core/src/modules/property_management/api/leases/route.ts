import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { E } from '#generated/entities.ids.generated'
import { Lease } from '../../data/entities'
import { leaseCreateBodySchema, leaseCreateSchema, leaseUpdateSchema } from '../../data/validators'
import { summarizeLeases } from '../../lib/leaseView'
import { LEASE_RESOURCE_KIND, type LeaseCreateResult } from '../../commands/lease'
import {
  asRecord,
  createPagedListResponseSchema,
  createPropertyManagementCrudOpenApi,
  crudEm,
  crudPermitted,
  crudScope,
  defaultOkResponseSchema,
  listItems,
  listQueryBase,
  parseScopedCommandInput,
  rawBodySchema,
  readIso,
  readNumber,
  readString,
  restrictBuildingField,
  withScopedPayload,
} from '../crudShared'
import { handleRouteError, resolveStaffContext, runStaffGuard } from '../routeContext'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
}

export const metadata = routeMetadata

export const LEASE_STATUS_FILTERS = ['proposed', 'pending_order', 'active', 'declined', 'withdrawn', 'expired', 'ended'] as const

const listSchema = z
  .object({
    ...listQueryBase,
    status: z.string().optional(),
    buildingId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    customerCompanyId: z.string().uuid().optional(),
  })
  .passthrough()

function parseStatuses(raw: string | undefined): string[] {
  if (!raw) return []
  const allowed = new Set<string>(LEASE_STATUS_FILTERS)
  return raw.split(',').map((value) => value.trim()).filter((value) => allowed.has(value))
}

function toItem(row: Record<string, unknown>) {
  return {
    id: readString(row, 'id'),
    reference: readString(row, 'reference'),
    status: readString(row, 'status'),
    buildingId: readString(row, 'building_id', 'buildingId'),
    unitId: readString(row, 'unit_id', 'unitId'),
    customerCompanyId: readString(row, 'customer_company_id', 'customerCompanyId'),
    primaryContactPersonId: readString(row, 'primary_contact_person_id', 'primaryContactPersonId'),
    startsOn: readString(row, 'starts_on', 'startsOn'),
    termMonths: readNumber(row, 'term_months', 'termMonths'),
    endsOn: readString(row, 'ends_on', 'endsOn'),
    salesOrderId: readString(row, 'sales_order_id', 'salesOrderId'),
    organizationId: readString(row, 'organization_id', 'organizationId'),
    tenantId: readString(row, 'tenant_id', 'tenantId'),
    createdAt: readIso(row, 'created_at', 'createdAt'),
    updatedAt: readIso(row, 'updated_at', 'updatedAt'),
  }
}

async function decorateLeases(payload: unknown, ctx: CrudCtx): Promise<void> {
  const scope = crudScope(ctx)
  const items = listItems(payload)
  if (!scope || !items.length) return
  const em = crudEm(ctx)
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const leases = await findWithDecryption(em, Lease, { ...scope, id: { $in: ids } }, undefined, scope)
  const summaries = new Map((await summarizeLeases(em, scope, leases)).map((summary) => [summary.id, summary]))
  for (const item of items) {
    const summary = summaries.get(readString(item, 'id') ?? '')
    if (summary) Object.assign(item, summary)
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: Lease, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: E.property_management.lease },
  list: {
    schema: listSchema,
    entityId: E.property_management.lease,
    fields: [
      'id',
      'reference',
      'status',
      'building_id',
      'unit_id',
      'customer_company_id',
      'primary_contact_person_id',
      'starts_on',
      'term_months',
      'ends_on',
      'sales_order_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: { reference: 'reference', startsOn: 'starts_on', endsOn: 'ends_on', updatedAt: 'updated_at', status: 'status' },
    defaultSort: { field: 'ends_on', dir: 'asc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      restrictBuildingField(filters, 'building_id', await crudPermitted(ctx), query.buildingId)
      if (query.id) filters.id = { $eq: query.id }
      if (query.unitId) filters.unit_id = { $eq: query.unitId }
      if (query.customerCompanyId) filters.customer_company_id = { $eq: query.customerCompanyId }
      const statuses = parseStatuses(query.status)
      if (statuses.length) filters.status = { $in: statuses }
      const term = query.search?.trim()
      if (term) filters.reference = { $ilike: `%${escapeLikePattern(term)}%` }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
  },
  hooks: { afterList: decorateLeases },
  actions: {
    update: {
      commandId: 'property_management.lease.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(leaseUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'property_management.lease.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return withScopedPayload({ id: resolveCrudRecordId(parsed, ctx, translate) }, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export async function POST(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const body = leaseCreateBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = leaseCreateSchema.parse({ ...body, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, { resourceKind: LEASE_RESOURCE_KIND, operation: 'create', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? leaseCreateSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const commandId = commandInput.asProposal ? 'property_management.lease.propose' : 'property_management.lease.create'
    const { result } = await commandBus.execute<typeof commandInput, LeaseCreateResult>(commandId, { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json(
      { id: result.leaseId, proposalId: result.proposalId, status: result.status, operationId: result.operationId },
      { status: 202 },
    )
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.lease_create_failed')
  }
}

const leaseItemSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(LEASE_STATUS_FILTERS),
  buildingId: z.string().uuid(),
  buildingName: z.string().nullable(),
  unitId: z.string().uuid(),
  unitName: z.string().nullable(),
  floorName: z.string().nullable(),
  customerCompanyId: z.string().uuid(),
  companyName: z.string().nullable(),
  primaryContactPersonId: z.string().uuid().nullable(),
  contactName: z.string().nullable(),
  startsOn: z.string(),
  termMonths: z.number().int(),
  endsOn: z.string(),
  daysLeft: z.number().int(),
  productName: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  currencyCode: z.string().nullable(),
  salesOrderId: z.string().uuid().nullable(),
  salesOrderNumber: z.string().nullable(),
  openProposal: z.object({ id: z.string().uuid(), kind: z.string(), status: z.string(), respondBy: z.string() }).nullable(),
  pendingChange: z.object({ kind: z.string(), changeId: z.string() }).nullable(),
  billingPending: z.boolean(),
  billingAttention: z.boolean(),
  unitUnavailable: z.boolean(),
  updatedAt: z.string(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Lease',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(leaseItemSchema),
  create: {
    schema: leaseCreateBodySchema,
    status: 202,
    responseSchema: z.object({
      id: z.string().uuid(),
      proposalId: z.string().uuid().nullable(),
      status: z.enum(['pending_order', 'sending']),
      operationId: z.string().uuid(),
    }),
    description:
      'Creates a lease. `asProposal: false` records a direct lease (`pending_order`) whose recurring sales order is created on the queue; `asProposal: true` records a proposal whose recurring quote is created on the queue. 409 when another lease or open proposal of the unit overlaps the term; 422 `billing_channel_missing`, unit not leasable or references outside the organization.',
  },
  update: {
    schema: leaseUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Changes the primary contact person of a lease.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Deletes a lease before any invoice: withdraws its open proposals and cancels every recurring order from its start (never deletes an order). 409 `lease_invoiced` once an invoice exists, 409 `lease_change_pending` while a billing update is pending.',
  },
})
