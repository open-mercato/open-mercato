import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
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

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'Get enriched company data for a person\'s linked companies',
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

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })

    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = (container.resolve('em') as EntityManager).fork()

    const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
    const person = await findOneWithDecryption(em, CustomerEntity, { id, kind: 'person', deletedAt: null }, {}, decryptionScope)
    if (!person || person.tenantId !== auth.tenantId) {
      throw new CrudHttpError(404, { error: 'Person not found' })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size > 0 && !allowedOrgIds.has(person.organizationId)) {
      throw new CrudHttpError(403, { error: 'Access denied' })
    }

    const entityScope = { tenantId: auth.tenantId, organizationId: person.organizationId }
    const links = await findWithDecryption(em, CustomerPersonCompanyLink, {
      person,
      tenantId: auth.tenantId,
    }, { populate: ['company'] }, entityScope)

    const companyIds = links.map((link) => (link.company as CustomerEntity).id)

    if (companyIds.length === 0) {
      return NextResponse.json({ items: [] })
    }

    const [allProfiles, allAddresses, allBillings, allTagAssignments, allRoles, allDealLinks, allInteractions] =
      await Promise.all([
        findWithDecryption(em, CustomerCompanyProfile, { entity: { $in: companyIds } }, {}, entityScope),
        findWithDecryption(em, CustomerAddress, { entity: { $in: companyIds }, isPrimary: true }, {}, entityScope),
        findWithDecryption(em, CustomerCompanyBilling, { entity: { $in: companyIds } }, {}, entityScope),
        findWithDecryption(em, CustomerTagAssignment, { entity: { $in: companyIds } }, { populate: ['tag'] }, entityScope),
        findWithDecryption(em, CustomerPersonCompanyRole, { personEntity: person, companyEntity: { $in: companyIds } }, {}, entityScope),
        findWithDecryption(em, CustomerDealCompanyLink, { company: { $in: companyIds } }, { populate: ['deal'] }, entityScope),
        findWithDecryption(em, CustomerInteraction, {
          entity: { $in: companyIds },
          occurredAt: { $ne: null },
          deletedAt: null,
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

    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
