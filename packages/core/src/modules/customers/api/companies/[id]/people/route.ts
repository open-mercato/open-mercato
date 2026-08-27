import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { CustomerEntity } from '../../../../data/entities'
import { loadCompanyPeopleUnion } from '../../../../lib/personCompanies'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sort: z.enum(['name-asc', 'name-desc', 'recent']).default('name-asc'),
})

type CompanyPersonItem = {
  id: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  status: string | null
  lifecycleStage: string | null
  jobTitle: string | null
  department: string | null
  createdAt: string
  organizationId: string
  temperature: string | null
  source: string | null
  linkedAt: string | null
}

function matchesSearch(item: CompanyPersonItem, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized.length) return true
  return [
    item.displayName,
    item.primaryEmail,
    item.primaryPhone,
    item.jobTitle,
    item.department,
    item.status,
    item.lifecycleStage,
    item.source,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalized))
}

function sortItems(items: CompanyPersonItem[], sort: 'name-asc' | 'name-desc' | 'recent'): CompanyPersonItem[] {
  if (sort === 'recent') {
    return [...items].sort((left, right) => {
      const leftTimestamp = left.linkedAt ? new Date(left.linkedAt).getTime() : new Date(left.createdAt).getTime()
      const rightTimestamp = right.linkedAt ? new Date(right.linkedAt).getTime() : new Date(right.createdAt).getTime()
      if (leftTimestamp === rightTimestamp) return left.displayName.localeCompare(right.displayName)
      return rightTimestamp - leftTimestamp
    })
  }

  return [...items].sort((left, right) => {
    const compare = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
    return sort === 'name-asc' ? compare : -compare
  })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const query = querySchema.parse({
      page: new URL(req.url).searchParams.get('page') ?? undefined,
      pageSize: new URL(req.url).searchParams.get('pageSize') ?? undefined,
      search: new URL(req.url).searchParams.get('search') ?? undefined,
      sort: new URL(req.url).searchParams.get('sort') ?? undefined,
    })

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = (container.resolve('em') as EntityManager).fork()
    const decryptionScope = {
      tenantId: auth.tenantId,
      organizationId: scope?.selectedId ?? auth.orgId ?? null,
    }

    const company = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id, kind: 'company', tenantId: auth.tenantId, deletedAt: null },
      {},
      decryptionScope,
    )
    if (!company) {
      throw notFound(translate('customers.errors.company_not_found', 'Company not found'))
    }

    // Existence oracle (#5504): deny a cross-org read as not-found — identical to
    // the parent-not-found above — so it cannot reveal that a company exists in an
    // organization the caller cannot see.
    if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: company.organizationId })) {
      throw notFound(translate('customers.errors.company_not_found', 'Company not found'))
    }

    const entityScope = { tenantId: auth.tenantId, organizationId: company.organizationId }
    const union = await loadCompanyPeopleUnion(em, company, entityScope)

    const items = union.map(({ entity: person, profile, linkedAt }) => ({
      id: person.id,
      displayName: person.displayName ?? person.primaryEmail ?? person.id,
      primaryEmail: person.primaryEmail ?? null,
      primaryPhone: person.primaryPhone ?? null,
      status: person.status ?? null,
      lifecycleStage: person.lifecycleStage ?? null,
      jobTitle: profile?.jobTitle ?? null,
      department: profile?.department ?? null,
      createdAt: person.createdAt.toISOString(),
      organizationId: person.organizationId,
      temperature: person.temperature ?? null,
      source: person.source ?? null,
      linkedAt,
    } satisfies CompanyPersonItem))

    const filtered = query.search?.trim().length ? items.filter((item) => matchesSearch(item, query.search ?? '')) : items
    const sorted = sortItems(filtered, query.sort)
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
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    logger.error('customers.companies.people.GET', { err: error })
    return NextResponse.json({ error: translate('customers.errors.company_people_load_failed', 'Failed to load linked people') }, { status: 500 })
  }
}

const companyPeopleItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  primaryEmail: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  status: z.string().nullable(),
  lifecycleStage: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  createdAt: z.string(),
  organizationId: z.string().uuid().nullable(),
  temperature: z.string().nullable(),
  source: z.string().nullable(),
  linkedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked people for a company',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Paginated linked people',
          schema: z.object({
            items: z.array(companyPeopleItemSchema),
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
