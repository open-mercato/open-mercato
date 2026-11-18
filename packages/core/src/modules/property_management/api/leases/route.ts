import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { E } from '#generated/entities.ids.generated'
import { Lease } from '../../data/entities'
import { leaseCreateBodySchema, leaseCreateSchema, leaseUpdateSchema, liftCustomFields } from '../../data/validators'
import { summarizeLeases } from '../../lib/leaseView'
import { findLeaseIdsWithUnavailableUnit } from '../../lib/leaseAvailability'
import { NO_MATCH_ID } from '../../lib/buildingAccess'
import { hasSalesFeature, SALES_ORDERS_VIEW_FEATURE } from '../../lib/creditPermission'
import { NO_CRM_ACCESS, resolveCrmAccess } from '../../lib/crmAccess'
import { LEASE_RESOURCE_KIND, type LeaseCreateResult } from '../../commands/lease'
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
  unscopedDocSchema,
} from '../crudShared'
import { guardedCommandInput, handleRouteError, resolveStaffContext, runStaffGuard } from '../routeContext'

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
    unitUnavailable: z.enum(['true', 'false']).optional(),
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
    ...extractAllCustomFieldEntries(row),
  }
}

async function decorateLeases(payload: unknown, ctx: CrudCtx): Promise<void> {
  const scope = crudScope(ctx)
  const crmAccess = scope ? await resolveCrmAccess(ctx.container, ctx.auth ?? null, scope) : NO_CRM_ACCESS
  attachCrmAccess(payload, crmAccess)
  const items = listItems(payload)
  if (!scope || !items.length) return
  const em = crudEm(ctx)
  const canViewOrders = await hasSalesFeature(ctx.container, ctx.auth, scope, SALES_ORDERS_VIEW_FEATURE)
  const ids = items.map((item) => readString(item, 'id')).filter((id): id is string => Boolean(id))
  const leases = await findWithDecryption(em, Lease, { ...scope, id: { $in: ids } }, undefined, scope)
  const summaries = new Map((await summarizeLeases(em, scope, leases, { crmAccess, salesOrderNumbers: canViewOrders })).map((summary) => [summary.id, summary]))
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
    disableListCache: true,
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
    omitAutomaticTenantOrgScope: true,
    buildFilters: async (query, ctx) => {
      const scope = crudScopeFilters(ctx)
      const permitted = await crudPermitted(ctx)
      restrictBuildingField(scope, 'building_id', permitted, query.buildingId)
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      const statuses = parseStatuses(query.status)
      if (query.unitUnavailable === 'true') {
        const leaseScope = crudScope(ctx)
        const buildingScope = query.buildingId ? [query.buildingId].filter((id) => permitted === null || permitted.includes(id)) : permitted
        const narrowing = { statuses, unitId: query.unitId, customerCompanyId: query.customerCompanyId, leaseId: query.id }
        const flagged = leaseScope ? await findLeaseIdsWithUnavailableUnit(crudEm(ctx), leaseScope, buildingScope, narrowing) : []
        filters.id = { $in: flagged.length ? flagged : [NO_MATCH_ID] }
      }
      if (query.unitId) filters.unit_id = { $eq: query.unitId }
      if (query.customerCompanyId) filters.customer_company_id = { $eq: query.customerCompanyId }
      if (statuses.length) filters.status = { $in: statuses }
      const term = query.search?.trim()
      if (term) filters.reference = { $ilike: `%${escapeLikePattern(term)}%` }
      return sealListScope(scope, filters)
    },
    transformItem: (item: Record<string, unknown>) => toItem(asRecord(item)),
    decorateCustomFields: { entityIds: E.property_management.lease, stripPrefixedKeys: true },
  },
  hooks: { afterList: decorateLeases },
  actions: {
    update: {
      commandId: 'property_management.lease.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(leaseUpdateSchema, liftCustomFields(raw ?? {}), ctx, translate)
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
    const body = leaseCreateBodySchema.parse(liftCustomFields((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}))
    const input = leaseCreateSchema.parse({ ...body, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, { resourceKind: LEASE_RESOURCE_KIND, operation: 'create', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(leaseCreateSchema, guarded, input, { tenantId: context.tenantId, organizationId: context.organizationId })
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
  companyName: z.string().nullable().optional().describe('Present only with `customers.companies.view`; `customerCompanyId` is always returned'),
  primaryContactPersonId: z.string().uuid().nullable(),
  contactName: z.string().nullable().optional().describe('Present only with `customers.people.view`; `primaryContactPersonId` is always returned'),
  startsOn: z.string(),
  termMonths: z.number().int(),
  endsOn: z.string(),
  daysLeft: z.number().int(),
  productName: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  currencyCode: z.string().nullable(),
  salesOrderId: z.string().uuid().nullable(),
  salesOrderNumber: z.string().nullable().describe('Null unless the caller has `sales.orders.view`; `salesOrderId` is always returned'),
  openProposal: z.object({ id: z.string().uuid(), kind: z.string(), status: z.string(), respondBy: z.string() }).nullable(),
  pendingChange: z.object({ kind: z.string(), changeId: z.string() }).nullable(),
  billingPending: z.boolean(),
  billingAttention: z.boolean(),
  unitUnavailable: z.boolean(),
  unitUnavailableFrom: z.string().nullable(),
  unitUnavailableUntil: z.string().nullable(),
  updatedAt: z.string(),
  customValues: z.record(z.string(), z.unknown()).nullable().optional(),
  customFields: z.array(z.object({ key: z.string(), label: z.string(), value: z.unknown(), kind: z.string().nullable(), multi: z.boolean() })).optional(),
})

export const openApi = createPropertyManagementCrudOpenApi({
  resourceName: 'Lease',
  description:
    'Returns a paginated collection of leases in the buildings the caller may see. CRM names are gated on the customers features: `contactName` is present only with `customers.people.view` and `companyName` only with `customers.companies.view`; otherwise those keys are omitted (the ids stay) and no CRM record is read. The top-level `crmAccess` tells the caller which of the two it has. `salesOrderNumber` is null unless the caller has `sales.orders.view`.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(leaseItemSchema).extend({ crmAccess: crmAccessSchema }),
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
      'Creates a lease. `asProposal: false` records a direct lease (`pending_order`) whose recurring sales order is created on the queue; `asProposal: true` records a proposal whose recurring quote is created on the queue. 409 `lease_overlap` when another lease or open proposal of the unit overlaps the term, 409 `lease_overlaps_bookings` (with at most 100 `blockers` and their total `blockerCount`) when holding bookings of the unit fall inside it; 422 `billing_channel_missing`, unit not leasable or references outside the organization.',
  },
  update: {
    schema: unscopedDocSchema(leaseUpdateSchema),
    responseSchema: defaultOkResponseSchema,
    description: 'Changes the primary contact person of a lease.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Deletes a lease before any invoice: withdraws its open proposals and cancels every recurring order from its start (never deletes an order). 409 `lease_invoiced` once an invoice exists, 409 `lease_change_pending` while a billing update is pending, 409 `lease_billing_cancel_unavailable` while sales cannot cancel recurring orders and the lease has (or is creating) a sales order.',
    errors: [
      {
        status: 409,
        description:
          '`lease_invoiced` (an invoice exists), `lease_change_pending` (a billing update is pending) or `lease_billing_cancel_unavailable` (sales has no recurring-order cancel command registered and the lease has or is creating a sales order)',
      },
    ],
  },
})
