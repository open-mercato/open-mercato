import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerCompanyProfile, CustomerDeal, CustomerDealCompanyLink, CustomerEntity } from '../../../../data/entities'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sort: z.enum(['label-asc', 'label-desc', 'name-asc', 'name-desc', 'recent']).default('label-asc'),
})

type DealLinkedEntitySort = 'label-asc' | 'label-desc' | 'recent'

function normalizeSort(sort: z.infer<typeof querySchema>['sort']): DealLinkedEntitySort {
  if (sort === 'name-asc') return 'label-asc'
  if (sort === 'name-desc') return 'label-desc'
  return sort
}

type DealCompanyItem = {
  id: string
  label: string
  subtitle: string | null
  kind: 'company'
  linkedAt: string
}

function matchesSearch(item: DealCompanyItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized.length) return true
  return [item.label, item.subtitle]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalized))
}

function sortItems(items: DealCompanyItem[], sort: 'label-asc' | 'label-desc' | 'recent'): DealCompanyItem[] {
  if (sort === 'recent') {
    return [...items].sort((left, right) => {
      const compare = new Date(right.linkedAt).getTime() - new Date(left.linkedAt).getTime()
      if (compare !== 0) return compare
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    })
  }
  return [...items].sort((left, right) => {
    const compare = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    return sort === 'label-asc' ? compare : -compare
  })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const url = new URL(req.url)
    const query = querySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      sort: url.searchParams.get('sort') ?? undefined,
    })

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = (container.resolve('em') as EntityManager).fork()
    const decryptionScope = {
      tenantId: auth.tenantId,
      organizationId: scope?.selectedId ?? auth.orgId ?? null,
    }

    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id, tenantId: auth.tenantId, deletedAt: null },
      {},
      decryptionScope,
    )
    if (!deal) {
      throw new CrudHttpError(404, { error: translate('customers.errors.deal_not_found', 'Deal not found') })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)
    if (allowedOrgIds.size > 0 && deal.organizationId && !allowedOrgIds.has(deal.organizationId)) {
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }

    const entityScope = { tenantId: deal.tenantId, organizationId: deal.organizationId }
    const links = await findWithDecryption(
      em,
      CustomerDealCompanyLink,
      { deal: deal.id },
      { populate: ['company'] },
      entityScope,
    )

    const companyIds = links
      .map((link) => link.company?.id)
      .filter((companyId): companyId is string => typeof companyId === 'string' && companyId.length > 0)
    const profiles = companyIds.length > 0
      ? await findWithDecryption(
          em,
          CustomerCompanyProfile,
          {
            entity: { $in: companyIds },
            tenantId: deal.tenantId,
            organizationId: deal.organizationId,
          },
          {},
          entityScope,
        )
      : []
    const profileByCompanyId = new Map(
      profiles.map((profile) => [(profile.entity as { id: string }).id, profile]),
    )

    const items = links
      .map((link) => {
        const company = link.company as CustomerEntity | null
        if (!company?.id) return null
        const profile = profileByCompanyId.get(company.id) ?? null
        return {
          id: company.id,
          label: company.displayName ?? profile?.domain ?? company.id,
          subtitle: profile?.domain ?? company.primaryEmail ?? company.primaryPhone ?? null,
          kind: 'company',
          linkedAt: link.createdAt.toISOString(),
        } satisfies DealCompanyItem
      })
      .filter((item): item is DealCompanyItem => item !== null)

    const filtered = query.search?.trim().length ? items.filter((item) => matchesSearch(item, query.search ?? '')) : items
    const sorted = sortItems(filtered, normalizeSort(query.sort))
    const total = sorted.length
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
    const page = Math.min(query.page, totalPages)
    const start = (page - 1) * query.pageSize

    return NextResponse.json({
      items: sorted.slice(start, start + query.pageSize),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    console.error('[customers.deals.companies.GET]', error)
    return NextResponse.json({ error: translate('customers.errors.deal_companies_load_failed', 'Failed to load linked companies') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked companies for a deal',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Paginated linked companies',
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                label: z.string(),
                subtitle: z.string().nullable(),
                kind: z.literal('company'),
                linkedAt: z.string(),
              }),
            ),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
            totalPages: z.number().int().min(1),
          }),
        },
      ],
    },
  },
}
