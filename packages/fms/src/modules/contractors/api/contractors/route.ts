import { z } from 'zod'
import { NextResponse } from 'next/server'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Contractor } from '../../data/entities'
import { contractorCreateSchema, contractorUpdateSchema, contractorListQuerySchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'

const rawBodySchema = z.object({}).passthrough()

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
      'code',
      'parent_id',
      'tax_id',
      'legal_name',
      'registration_number',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      code: 'code',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}

      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { name: { $ilike: pattern } },
          { code: { $ilike: pattern } },
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
      code: item.code ?? null,
      parentId: item.parent_id ?? null,
      taxId: item.tax_id ?? null,
      legalName: item.legal_name ?? null,
      registrationNumber: item.registration_number ?? null,
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

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    deletedAt: null,
    ...scopeFilters,
  }

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    filters.$or = [
      { name: { $ilike: pattern } },
      { code: { $ilike: pattern } },
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
    const fieldMap: Record<string, string> = {
      name: 'name',
      code: 'code',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    }
    const dbField = fieldMap[sortField] || 'createdAt'
    orderBy[dbField] = sortDir || 'desc'
  } else {
    orderBy.createdAt = 'desc'
  }

  const [contractors, total] = await em.findAndCount(Contractor, filters, {
    populate: ['roles', 'roles.roleType', 'creditLimit', 'paymentTerms', 'contacts', 'addresses'],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy,
  })

  const items = contractors.map((contractor) => {
    // Find primary contact or first active contact
    const contacts = contractor.contacts.getItems()
    const primaryContact = contacts.find(c => c.isPrimary && c.isActive) ?? contacts.find(c => c.isActive) ?? null

    // Find primary address or first active address
    const addresses = contractor.addresses.getItems()
    const primaryAddress = addresses.find(a => a.isPrimary && a.isActive) ?? addresses.find(a => a.isActive) ?? null

    return {
      id: contractor.id,
      name: contractor.name,
      shortName: contractor.shortName ?? null,
      code: contractor.code ?? null,
      parentId: contractor.parentId ?? null,
      taxId: contractor.taxId ?? null,
      legalName: contractor.legalName ?? null,
      registrationNumber: contractor.registrationNumber ?? null,
      isActive: contractor.isActive,
      organizationId: contractor.organizationId,
      tenantId: contractor.tenantId,
      createdAt: contractor.createdAt?.toISOString(),
      updatedAt: contractor.updatedAt?.toISOString(),
      roles: contractor.roles.getItems().map((role) => ({
        id: role.id,
        roleTypeId: role.roleType.id,
        roleTypeName: role.roleType.name,
        roleTypeCode: role.roleType.code,
        roleTypeColor: role.roleType.color,
        roleTypeCategory: role.roleType.category,
        isActive: role.isActive,
      })),
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
        addressLine1: primaryAddress.addressLine1,
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
