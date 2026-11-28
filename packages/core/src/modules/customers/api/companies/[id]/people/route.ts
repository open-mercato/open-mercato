import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { CustomerEntity, CustomerPersonCompanyLink } from '../../../../data/entities'
import { loadCompanyPeopleUnion } from '../../../../lib/personCompanies'
import { resolveAuthActorId } from '../../../../lib/interactionRequestContext'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customers')

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sort: z.enum(['name-asc', 'name-desc', 'recent']).default('name-asc'),
  employmentStatus: z.enum(['active', 'ended']).default('active'),
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
  linkId?: string | null
  updatedAt?: string | null
  employmentEndedOn?: string
}

async function loadFormerEmployees(em: EntityManager, company: CustomerEntity): Promise<CompanyPersonItem[]> {
  const scope = { tenantId: company.tenantId, organizationId: company.organizationId }
  const links = await findWithDecryption(
    em, CustomerPersonCompanyLink,
    { ...scope, company, deletedAt: null, employmentStatus: 'ended', person: { ...scope, kind: 'person', deletedAt: null } },
    { populate: ['person'] }, scope,
  )
  return links.flatMap((link) => {
    const person = typeof link.person === 'string' ? null : link.person
    if (!person || person.deletedAt || person.kind !== 'person' || person.tenantId !== scope.tenantId
      || person.organizationId !== scope.organizationId || !link.employmentEndedOn || link.deletedAt
      || link.employmentStatus !== 'ended') return []
    return [{
      id: person.id,
      displayName: person.displayName || person.id,
      primaryEmail: null,
      primaryPhone: null,
      status: null,
      lifecycleStage: null,
      jobTitle: null,
      department: null,
      createdAt: person.createdAt.toISOString(),
      organizationId: person.organizationId,
      temperature: null,
      source: null,
      linkedAt: link.createdAt.toISOString(),
      employmentEndedOn: link.employmentEndedOn,
    }]
  })
}

async function loadActivePeople(em: EntityManager, company: CustomerEntity): Promise<CompanyPersonItem[]> {
  const scope = { tenantId: company.tenantId, organizationId: company.organizationId }
  const union = await loadCompanyPeopleUnion(em, company, scope)
  return union.map(({ entity: person, profile, linkedAt, linkId, updatedAt }) => ({
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
    linkId,
    updatedAt,
  }))
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
      const leftTimestamp = Date.parse(left.employmentEndedOn ?? left.linkedAt ?? left.createdAt)
      const rightTimestamp = Date.parse(right.employmentEndedOn ?? right.linkedAt ?? right.createdAt)
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

    const searchParams = new URL(req.url).searchParams
    const query = querySchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      employmentStatus: searchParams.get('employmentStatus') ?? undefined,
    })

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = (container.resolve('em') as EntityManager).fork()
    const decryptionScope = {
      tenantId: auth.tenantId,
      organizationId: resolveSingleOrganizationIdOrDeny(scope, auth) ?? null,
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
    if (query.employmentStatus === 'ended') {
      const rbac = container.resolve<RbacService>('rbacService')
      const grantedFeatures = await rbac.getGrantedFeatures(resolveAuthActorId(auth), entityScope)
      if (!authorizeFeatures(['customers.people.view'], { grantedFeatures })) {
        throw new CrudHttpError(403, { error: translate('api.errors.forbidden', 'Forbidden') })
      }
    }
    const items = query.employmentStatus === 'ended'
      ? await loadFormerEmployees(em, company)
      : await loadActivePeople(em, company)

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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: translate('customers.errors.validationFailed', 'Validation failed'), details: error.issues }, { status: 400 })
    }
    logger.error('customers.companies.people.GET', { err: error })
    reportTelemetryError(error, { module: 'customers', code: 'customers.company_people_load_failed' })
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
  linkId: z.string().uuid().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  employmentEndedOn: z.iso.date().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List current or former people linked to a company',
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
