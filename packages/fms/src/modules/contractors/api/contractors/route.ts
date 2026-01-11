import { z } from 'zod'
import { NextResponse } from 'next/server'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Contractor, ContractorRoleType } from '../../data/entities'
import { contractorCreateSchema, contractorUpdateSchema, contractorListQuerySchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'

const rawBodySchema = z.object({}).passthrough()

// Field mapping from frontend camelCase to database field names
const FIELD_MAP: Record<string, string> = {
  name: 'name',
  shortName: 'shortName',
  taxId: 'taxId',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
}

// Parse DynamicTable FilterRow into MikroORM filter format
function parseFilterRow(row: { field: string; operator: string; values: unknown[] }): Record<string, unknown> | null {
  const field = FIELD_MAP[row.field]
  if (!field) return null

  switch (row.operator) {
    case 'is_any_of':
      return { [field]: { $in: row.values } }
    case 'is_not_any_of':
      return { [field]: { $nin: row.values } }
    case 'contains':
      return { [field]: { $ilike: `%${row.values[0] || ''}%` } }
    case 'is_empty':
      return { [field]: { $eq: null } }
    case 'is_not_empty':
      return { [field]: { $ne: null } }
    case 'equals':
      return { [field]: { $eq: row.values[0] } }
    case 'not_equals':
      return { [field]: { $ne: row.values[0] } }
    case 'is_true':
      return { [field]: { $eq: true } }
    case 'is_false':
      return { [field]: { $eq: false } }
    default:
      return null
  }
}

const listSchema = contractorListQuerySchema.extend({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
  POST: { requireAuth: true, requireFeatures: ['contractors.create'] },
  PUT: { requireAuth: true, requireFeatures: ['contractors.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['contractors.delete'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Contractor,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'name',
      'short_name',
      'parent_id',
      'tax_id',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
      'role_type_ids',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}

      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { name: { $ilike: pattern } },
          { tax_id: { $ilike: pattern } },
        ]
      }

      if (typeof query.isActive === 'boolean') {
        filters.is_active = { $eq: query.isActive }
      }

      if (typeof query.hasParent === 'boolean') {
        if (query.hasParent) {
          filters.parent_id = { $ne: null }
        } else {
          filters.parent_id = { $eq: null }
        }
      }

      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      name: item.name,
      shortName: item.short_name ?? null,
      parentId: item.parent_id ?? null,
      taxId: item.tax_id ?? null,
      isActive: item.is_active ?? true,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'contractors.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const parsed = contractorCreateSchema.parse(scoped)
        return {
          ...parsed,
          organizationId: scoped.organizationId,
          tenantId: scoped.tenantId,
        }
      },
      response: ({ result }) => ({ id: result?.contractorId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'contractors.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const parsed = contractorUpdateSchema.parse(scoped)
        return {
          ...parsed,
          id: scoped.id ?? (raw as Record<string, unknown>)?.id,
          organizationId: scoped.organizationId,
          tenantId: scoped.tenantId,
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'contractors.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('contractors.validation.idRequired', 'Contractor id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

function buildScopeFilters(
  auth: { tenantId?: string | null; orgId?: string | null },
  scope: { tenantId?: string | null; selectedId?: string | null; filterIds?: string[] | null } | null
): { tenantId?: string; organizationId?: { $in: string[] } } {
  const filters: { tenantId?: string; organizationId?: { $in: string[] } } = {}

  if (typeof auth.tenantId === 'string') {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  const filterIds = scope?.filterIds
  if (Array.isArray(filterIds) && filterIds.length > 0) {
    filterIds.forEach((id) => {
      if (typeof id === 'string') allowedOrgIds.add(id)
    })
  } else {
    const fallbackOrgId = scope?.selectedId ?? auth.orgId
    if (typeof fallbackOrgId === 'string') {
      allowedOrgIds.add(fallbackOrgId)
    }
  }

  if (allowedOrgIds.size > 0) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  return filters
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = listSchema.safeParse({
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    sortField: url.searchParams.get('sortField') || undefined,
    sortDir: url.searchParams.get('sortDir') || undefined,
    search: url.searchParams.get('search') || undefined,
    isActive: url.searchParams.get('isActive') || undefined,
    hasParent: url.searchParams.get('hasParent') || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const { page, pageSize, sortField, sortDir, search, isActive, hasParent } = parsed.data

  // Parse DynamicTable filters from query string
  const filtersParam = url.searchParams.get('filters')
  let dynamicFilters: Array<{ field: string; operator: string; values: unknown[] }> = []
  if (filtersParam) {
    try {
      dynamicFilters = JSON.parse(filtersParam)
    } catch {
      // Ignore invalid JSON
    }
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    deletedAt: null,
    ...scopeFilters,
  }

  // Apply DynamicTable filters
  if (dynamicFilters.length > 0) {
    const parsedFilters = dynamicFilters
      .map(parseFilterRow)
      .filter((f): f is Record<string, unknown> => f !== null)

    if (parsedFilters.length > 0) {
      filters.$and = [...(filters.$and as Record<string, unknown>[] || []), ...parsedFilters]
    }
  }

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    filters.$or = [
      { name: { $ilike: pattern } },
      { taxId: { $ilike: pattern } },
    ]
  }

  if (typeof isActive === 'boolean') {
    filters.isActive = isActive
  }

  if (typeof hasParent === 'boolean') {
    if (hasParent) {
      filters.parentId = { $ne: null }
    } else {
      filters.parentId = { $eq: null }
    }
  }

  const orderBy: Record<string, 'asc' | 'desc'> = {}
  if (sortField) {
    const dbField = FIELD_MAP[sortField] || 'createdAt'
    orderBy[dbField] = sortDir || 'desc'
  } else {
    orderBy.createdAt = 'desc'
  }

  const [contractors, total] = await em.findAndCount(Contractor, filters, {
    populate: ['creditLimit', 'paymentTerms', 'contacts', 'addresses'],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy,
  })

  // Collect all role type IDs from all contractors
  const allRoleTypeIds = new Set<string>()
  contractors.forEach((contractor) => {
    if (contractor.roleTypeIds && Array.isArray(contractor.roleTypeIds)) {
      contractor.roleTypeIds.forEach((id) => allRoleTypeIds.add(id))
    }
  })

  // Fetch all role types in one query
  const roleTypesMap = new Map<string, ContractorRoleType>()
  if (allRoleTypeIds.size > 0) {
    const roleTypes = await em.find(ContractorRoleType, {
      id: { $in: [...allRoleTypeIds] },
    })
    roleTypes.forEach((rt) => roleTypesMap.set(rt.id, rt))
  }

  const items = contractors.map((contractor) => {
    // Find primary contact or first active contact
    const contacts = contractor.contacts.getItems()
    const primaryContact = contacts.find(c => c.isPrimary && c.isActive) ?? contacts.find(c => c.isActive) ?? null

    // Find primary address or first active address
    const addresses = contractor.addresses.getItems()
    const primaryAddress = addresses.find(a => a.isPrimary && a.isActive) ?? addresses.find(a => a.isActive) ?? null

    // Map role type IDs to role type details
    const roles = (contractor.roleTypeIds ?? [])
      .map((id) => roleTypesMap.get(id))
      .filter((rt): rt is ContractorRoleType => rt != null)
      .map((rt) => ({
        id: rt.id,
        roleTypeId: rt.id,
        roleTypeName: rt.name,
        roleTypeCode: rt.code,
        roleTypeColor: rt.color,
        roleTypeCategory: rt.category,
        isActive: true,
      }))

    return {
      id: contractor.id,
      name: contractor.name,
      shortName: contractor.shortName ?? null,
      parentId: contractor.parentId ?? null,
      taxId: contractor.taxId ?? null,
      isActive: contractor.isActive,
      organizationId: contractor.organizationId,
      tenantId: contractor.tenantId,
      createdAt: contractor.createdAt?.toISOString(),
      updatedAt: contractor.updatedAt?.toISOString(),
      roleTypeIds: contractor.roleTypeIds ?? [],
      roles,
      creditLimit: contractor.creditLimit ? {
        creditLimit: contractor.creditLimit.creditLimit,
        currencyCode: contractor.creditLimit.currencyCode,
        isUnlimited: contractor.creditLimit.isUnlimited,
      } : null,
      paymentTerms: contractor.paymentTerms ? {
        paymentDays: contractor.paymentTerms.paymentDays,
        paymentMethod: contractor.paymentTerms.paymentMethod,
        currencyCode: contractor.paymentTerms.currencyCode,
      } : null,
      primaryContactEmail: primaryContact?.email ?? null,
      primaryAddress: primaryAddress ? {
        addressLine: primaryAddress.addressLine,
        city: primaryAddress.city,
        countryCode: primaryAddress.countryCode,
      } : null,
    }
  })

  return NextResponse.json({
    items,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
  })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
