import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../../../../data/entities'
import {
  filterActivePersonCompanyLinks,
  withActiveCustomerPersonCompanyLinkFilter,
} from '../../../../lib/personCompanyLinkTable'

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
      throw new CrudHttpError(404, { error: translate('customers.errors.company_not_found', 'Company not found') })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)
    if (allowedOrgIds.size > 0 && company.organizationId && !allowedOrgIds.has(company.organizationId)) {
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }

    const entityScope = { tenantId: auth.tenantId, organizationId: company.organizationId }
    const linkWhere = await withActiveCustomerPersonCompanyLinkFilter(
      em,
      {
        company: company.id,
        tenantId: company.tenantId,
        organizationId: company.organizationId,
      },
      'customers.companies.people.GET',
    )
    const links = filterActivePersonCompanyLinks(
      await findWithDecryption(
        em,
        CustomerPersonCompanyLink,
        linkWhere,
        { populate: ['person'] },
        entityScope,
      ),
    )

    const personIds = links
      .map((link) => link.person?.id)
      .filter((personId): personId is string => typeof personId === 'string' && personId.length > 0)

    const profiles = personIds.length > 0
      ? await findWithDecryption(
          em,
          CustomerPersonProfile,
          {
            entity: { $in: personIds },
            tenantId: company.tenantId,
            organizationId: company.organizationId,
          },
          {},
          entityScope,
        )
      : []
    const profileByPersonId = new Map(
      profiles.map((profile) => [(profile.entity as { id: string }).id, profile]),
    )

    const items = links
      .map((link) => {
        const person = link.person
        if (!person?.id) return null
        const profile = profileByPersonId.get(person.id) ?? null
        return {
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
          linkedAt: link.createdAt ? link.createdAt.toISOString() : null,
        } satisfies CompanyPersonItem
      })
      .filter((item): item is CompanyPersonItem => item !== null)

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
    console.error('[customers.companies.people.GET]', error)
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
