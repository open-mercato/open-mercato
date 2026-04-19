import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerPersonCompanyLink,
  CustomerAddress,
  CustomerCompanyBilling,
  CustomerPersonCompanyRole,
  CustomerTagAssignment,
  CustomerDealCompanyLink,
  CustomerDeal,
  CustomerInteraction,
} from '../../../../../data/entities'
import { withActiveCustomerPersonCompanyLinkFilter } from '../../../../../lib/personCompanyLinkTable'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sort: z.enum(['name-asc', 'name-desc', 'recent']).default('name-asc'),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'Get enriched company data for a person\'s linked companies',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Enriched company rows with profile, billing, tags, deals and more',
          schema: z.object({
            items: z.array(
              z.object({
                linkId: z.string().uuid(),
                companyId: z.string().uuid(),
                displayName: z.string(),
                isPrimary: z.boolean(),
                subtitle: z.string().nullable(),
                profile: z
                  .object({
                    industry: z.string().nullable(),
                    sizeBucket: z.string().nullable(),
                    legalName: z.string().nullable(),
                    domain: z.string().nullable(),
                    websiteUrl: z.string().nullable(),
                  })
                  .nullable(),
                billing: z
                  .object({
                    bankName: z.string().nullable(),
                    bankAccountMasked: z.string().nullable(),
                    paymentTerms: z.string().nullable(),
                    preferredCurrency: z.string().nullable(),
                  })
                  .nullable(),
                primaryAddress: z.object({ formatted: z.string() }).nullable(),
                tags: z.array(
                  z.object({
                    id: z.string().uuid(),
                    label: z.string(),
                    color: z.string().nullable(),
                  }),
                ),
                roles: z.array(
                  z.object({
                    id: z.string().uuid(),
                    roleValue: z.string(),
                  }),
                ),
                activeDeal: z
                  .object({
                    title: z.string(),
                    valueAmount: z.string().nullable(),
                    valueCurrency: z.string().nullable(),
                  })
                  .nullable(),
                lastContactAt: z.string().nullable(),
                clv: z.object({ amount: z.number(), currency: z.string() }).nullable(),
                status: z.string().nullable(),
                lifecycleStage: z.string().nullable(),
                temperature: z.string().nullable(),
                renewalQuarter: z.string().nullable(),
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

function formatAddress(address: CustomerAddress): string {
  return [address.addressLine1, address.city, address.region, address.postalCode]
    .filter(Boolean)
    .join(', ')
}

function buildSubtitle(industry: string | null | undefined, address: CustomerAddress | null): string | null {
  const parts: string[] = []
  if (industry) parts.push(industry)
  if (address) {
    const locationParts = [address.city, address.region].filter(Boolean)
    if (locationParts.length > 0) parts.push(locationParts.join(', '))
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function matchesSearch(item: Record<string, unknown>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized.length) return true
  return [
    typeof item.displayName === 'string' ? item.displayName : null,
    typeof item.subtitle === 'string' ? item.subtitle : null,
    typeof item.status === 'string' ? item.status : null,
    typeof item.lifecycleStage === 'string' ? item.lifecycleStage : null,
    typeof item.temperature === 'string' ? item.temperature : null,
    typeof item.renewalQuarter === 'string' ? item.renewalQuarter : null,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalized))
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })

    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
    }
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

    const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
    const person = await findOneWithDecryption(em, CustomerEntity, { id, kind: 'person', tenantId: auth.tenantId, deletedAt: null }, {}, decryptionScope)
    if (!person) {
      throw new CrudHttpError(404, { error: translate('customers.errors.person_not_found', 'Person not found') })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size > 0 && !allowedOrgIds.has(person.organizationId)) {
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }

    const entityScope = { tenantId: auth.tenantId, organizationId: person.organizationId }
    const linkWhere = await withActiveCustomerPersonCompanyLinkFilter(
      em,
      {
        person,
        tenantId: auth.tenantId,
      },
      'customers.people.companiesEnriched.GET',
    )
    const links = await findWithDecryption(
      em,
      CustomerPersonCompanyLink,
      linkWhere,
      { populate: ['company'] },
      entityScope,
    )

    const companyIds = links.map((link) => (link.company as CustomerEntity).id)

    if (companyIds.length === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        page: 1,
        pageSize: query.pageSize,
        totalPages: 1,
      })
    }

    const tenantScope = { tenantId: auth.tenantId, organizationId: person.organizationId }
    const [allProfiles, allAddresses, allBillings, allTagAssignments, allRoles, allDealLinks, allInteractions] =
      await Promise.all([
        findWithDecryption(em, CustomerCompanyProfile, { entity: { $in: companyIds }, ...tenantScope }, {}, entityScope),
        findWithDecryption(em, CustomerAddress, { entity: { $in: companyIds }, isPrimary: true, ...tenantScope }, {}, entityScope),
        findWithDecryption(em, CustomerCompanyBilling, { entity: { $in: companyIds }, ...tenantScope }, {}, entityScope),
        findWithDecryption(em, CustomerTagAssignment, { entity: { $in: companyIds }, ...tenantScope }, { populate: ['tag'] }, entityScope),
        findWithDecryption(em, CustomerPersonCompanyRole, { personEntity: person, companyEntity: { $in: companyIds }, ...tenantScope }, {}, entityScope),
        // CustomerDealCompanyLink is a pure junction table without tenantId/organizationId columns;
        // scoping flows transitively through the already-tenant-scoped `company` filter.
        findWithDecryption(em, CustomerDealCompanyLink, { company: { $in: companyIds } }, { populate: ['deal'] }, entityScope),
        findWithDecryption(em, CustomerInteraction, {
          entity: { $in: companyIds },
          occurredAt: { $ne: null },
          deletedAt: null,
          ...tenantScope,
        }, { orderBy: { occurredAt: 'DESC' } }, entityScope),
      ])

    const profileByCompany = new Map(allProfiles.map((p) => [(p.entity as { id: string }).id, p]))
    const addressByCompany = new Map(allAddresses.map((a) => [(a.entity as { id: string }).id, a]))
    const billingByCompany = new Map(allBillings.map((b) => [(b.entity as { id: string }).id, b]))

    const tagsByCompany = new Map<string, typeof allTagAssignments>()
    for (const ta of allTagAssignments) {
      const entityId = (ta.entity as { id: string }).id
      const existing = tagsByCompany.get(entityId) ?? []
      existing.push(ta)
      tagsByCompany.set(entityId, existing)
    }

    const rolesByCompany = new Map<string, typeof allRoles>()
    for (const role of allRoles) {
      const entityId = (role.companyEntity as { id: string }).id
      const existing = rolesByCompany.get(entityId) ?? []
      existing.push(role)
      rolesByCompany.set(entityId, existing)
    }

    const dealLinksByCompany = new Map<string, typeof allDealLinks>()
    for (const dcl of allDealLinks) {
      const entityId = (dcl.company as { id: string }).id
      const existing = dealLinksByCompany.get(entityId) ?? []
      existing.push(dcl)
      dealLinksByCompany.set(entityId, existing)
    }

    const lastInteractionByCompany = new Map<string, CustomerInteraction>()
    for (const interaction of allInteractions) {
      const entityId = (interaction.entity as { id: string }).id
      if (!lastInteractionByCompany.has(entityId)) {
        lastInteractionByCompany.set(entityId, interaction)
      }
    }

    const items = links.map((link) => {
      const company = link.company as CustomerEntity
      const companyId = company.id
      const profile = profileByCompany.get(companyId) ?? null
      const primaryAddress = addressByCompany.get(companyId) ?? null
      const billing = billingByCompany.get(companyId) ?? null
      const tagAssignments = tagsByCompany.get(companyId) ?? []
      const roles = rolesByCompany.get(companyId) ?? []
      const companyDealLinks = dealLinksByCompany.get(companyId) ?? []
      const lastInteraction = lastInteractionByCompany.get(companyId) ?? null

      const activeDeals = companyDealLinks
        .map((dcl) => dcl.deal as CustomerDeal)
        .filter((deal) => deal.status !== 'win' && deal.status !== 'loose' && !deal.deletedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      const activeDeal = activeDeals.length > 0 ? activeDeals[0] : null

      const wonDeals = companyDealLinks
        .map((dcl) => dcl.deal as CustomerDeal)
        .filter((deal) => deal.status === 'win' && !deal.deletedAt)
      let clv: { amount: number; currency: string } | null = null
      if (wonDeals.length > 0) {
        const currencies = new Map<string, number>()
        for (const deal of wonDeals) {
          if (deal.valueAmount) {
            const currency = deal.valueCurrency ?? 'USD'
            currencies.set(currency, (currencies.get(currency) ?? 0) + parseFloat(deal.valueAmount))
          }
        }
        if (currencies.size > 0) {
          const [currency, amount] = currencies.entries().next().value!
          clv = { amount, currency }
        }
      }

      return {
        linkId: link.id,
        companyId,
        displayName: company.displayName,
        isPrimary: Boolean(link.isPrimary),
        subtitle: buildSubtitle(profile?.industry, primaryAddress),
        profile: profile
          ? {
              industry: profile.industry ?? null,
              sizeBucket: profile.sizeBucket ?? null,
              legalName: profile.legalName ?? null,
              domain: profile.domain ?? null,
              websiteUrl: profile.websiteUrl ?? null,
            }
          : null,
        billing: billing
          ? {
              bankName: billing.bankName ?? null,
              bankAccountMasked: billing.bankAccountMasked ?? null,
              paymentTerms: billing.paymentTerms ?? null,
              preferredCurrency: billing.preferredCurrency ?? null,
            }
          : null,
        primaryAddress: primaryAddress ? { formatted: formatAddress(primaryAddress) } : null,
        tags: tagAssignments.map((ta) => {
          const tag = ta.tag as { id: string; label: string; color?: string | null }
          return {
            id: tag.id,
            label: tag.label,
            color: tag.color ?? null,
          }
        }),
        roles: roles.map((r) => ({ id: r.id, roleValue: r.roleValue })),
        activeDeal: activeDeal
          ? {
              title: activeDeal.title,
              valueAmount: activeDeal.valueAmount ?? null,
              valueCurrency: activeDeal.valueCurrency ?? null,
            }
          : null,
        lastContactAt: lastInteraction?.occurredAt?.toISOString() ?? null,
        clv,
        status: company.status ?? null,
        lifecycleStage: company.lifecycleStage ?? null,
        temperature: company.temperature ?? null,
        renewalQuarter: company.renewalQuarter ?? null,
      }
    })

    const filteredItems = query.search?.trim().length
      ? items.filter((item) => matchesSearch(item as Record<string, unknown>, query.search ?? ''))
      : items
    const sortedItems = [...filteredItems].sort((left, right) => {
      if (query.sort === 'recent') {
        const leftTimestamp = left.lastContactAt ? new Date(left.lastContactAt).getTime() : 0
        const rightTimestamp = right.lastContactAt ? new Date(right.lastContactAt).getTime() : 0
        if (leftTimestamp === rightTimestamp) {
          return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
        }
        return rightTimestamp - leftTimestamp
      }
      const compare = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
      return query.sort === 'name-asc' ? compare : -compare
    })

    const total = sortedItems.length
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
    const page = Math.min(query.page, totalPages)
    const start = (page - 1) * query.pageSize

    return NextResponse.json({
      items: sortedItems.slice(start, start + query.pageSize),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/people/[id]/companies/enriched] GET failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
