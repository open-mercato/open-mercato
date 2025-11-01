import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  CustomerEntity,
} from '../../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
}

function normalizePersonAssociation(entity: CustomerEntity): { label: string; subtitle: string | null } {
  const displayName = typeof entity.displayName === 'string' ? entity.displayName.trim() : ''
  const email =
    typeof entity.primaryEmail === 'string' && entity.primaryEmail.trim().length
      ? entity.primaryEmail.trim()
      : null
  const phone =
    typeof entity.primaryPhone === 'string' && entity.primaryPhone.trim().length
      ? entity.primaryPhone.trim()
      : null
  const jobTitle =
    entity.personProfile &&
    typeof (entity.personProfile as any)?.jobTitle === 'string' &&
    (entity.personProfile as any).jobTitle.trim().length
      ? ((entity.personProfile as any).jobTitle as string).trim()
      : null
  const subtitle = jobTitle ?? email ?? phone ?? null
  const label = displayName.length ? displayName : email ?? phone ?? entity.id
  return { label, subtitle }
}

function normalizeCompanyAssociation(entity: CustomerEntity): { label: string; subtitle: string | null } {
  const displayName = typeof entity.displayName === 'string' ? entity.displayName.trim() : ''
  const domain =
    entity.companyProfile &&
    typeof (entity.companyProfile as any)?.domain === 'string' &&
    (entity.companyProfile as any).domain.trim().length
      ? ((entity.companyProfile as any).domain as string).trim()
      : null
  const website =
    entity.companyProfile &&
    typeof (entity.companyProfile as any)?.websiteUrl === 'string' &&
    (entity.companyProfile as any).websiteUrl.trim().length
      ? ((entity.companyProfile as any).websiteUrl as string).trim()
      : null
  const subtitle = domain ?? website ?? null
  const label = displayName.length ? displayName : domain ?? website ?? entity.id
  return { label, subtitle }
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return notFound('Deal not found')
  }

  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return forbidden('Access denied')
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return forbidden('Access denied')
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = (container.resolve('em') as EntityManager)

  const deal = await em.findOne(
    CustomerDeal,
    { id: parsedParams.data.id, deletedAt: null },
    {
      populate: ['people.person', 'people.person.personProfile', 'companies.company', 'companies.company.companyProfile'],
    },
  )
  if (!deal) {
    return notFound('Deal not found')
  }

  if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
    return notFound('Deal not found')
  }

  const allowedOrgIds = new Set<string>()
  if (Array.isArray(scope?.filterIds)) {
    scope.filterIds.forEach((id) => {
      if (typeof id === 'string' && id.trim().length) allowedOrgIds.add(id)
    })
  } else if (auth.orgId) {
    allowedOrgIds.add(auth.orgId)
  }
  if (allowedOrgIds.size && deal.organizationId && !allowedOrgIds.has(deal.organizationId)) {
    return forbidden('Access denied')
  }

  const personLinks = await em.find(
    CustomerDealPersonLink,
    { deal: deal.id },
    { populate: ['person', 'person.personProfile'] },
  )
  const companyLinks = await em.find(
    CustomerDealCompanyLink,
    { deal: deal.id },
    { populate: ['company', 'company.companyProfile'] },
  )

  const people: DealAssociation[] = personLinks.reduce<DealAssociation[]>((acc, link) => {
    const entity = link.person as CustomerEntity | null
    if (!entity || entity.deletedAt) return acc
    const { label, subtitle } = normalizePersonAssociation(entity)
    acc.push({ id: entity.id, label, subtitle, kind: 'person' })
    return acc
  }, [])

  const companies: DealAssociation[] = companyLinks.reduce<DealAssociation[]>((acc, link) => {
    const entity = link.company as CustomerEntity | null
    if (!entity || entity.deletedAt) return acc
    const { label, subtitle } = normalizeCompanyAssociation(entity)
    acc.push({ id: entity.id, label, subtitle, kind: 'company' })
    return acc
  }, [])

  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_deal,
    recordIds: [deal.id],
    tenantIdByRecord: { [deal.id]: deal.tenantId ?? null },
    organizationIdByRecord: { [deal.id]: deal.organizationId ?? null },
    tenantFallbacks: [deal.tenantId ?? auth.tenantId ?? null].filter((value): value is string => !!value),
  })
  const customFields = customFieldValues[deal.id] ?? {}

  const viewerUserId = auth.isApiKey ? null : auth.sub ?? null
  let viewerName: string | null = null
  let viewerEmail: string | null = auth.email ?? null
  if (viewerUserId) {
    const viewer = await em.findOne(User, { id: viewerUserId })
    viewerName = viewer?.name ?? null
    viewerEmail = viewer?.email ?? viewerEmail ?? null
  }

  return NextResponse.json({
    deal: {
      id: deal.id,
      title: deal.title,
      description: deal.description ?? null,
      status: deal.status ?? null,
      pipelineStage: deal.pipelineStage ?? null,
      valueAmount: deal.valueAmount ?? null,
      valueCurrency: deal.valueCurrency ?? null,
      probability: deal.probability ?? null,
      expectedCloseAt: deal.expectedCloseAt ? deal.expectedCloseAt.toISOString() : null,
      ownerUserId: deal.ownerUserId ?? null,
      source: deal.source ?? null,
      organizationId: deal.organizationId ?? null,
      tenantId: deal.tenantId ?? null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    },
    people,
    companies,
    customFields,
    viewer: {
      userId: viewerUserId,
      name: viewerName,
      email: viewerEmail,
    },
  })
}

const dealDetailResponseSchema = z.object({
  deal: z.object({
    id: z.string().uuid(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    pipelineStage: z.string().nullable().optional(),
    valueAmount: z.number().nullable().optional(),
    valueCurrency: z.string().nullable().optional(),
    probability: z.number().nullable().optional(),
    expectedCloseAt: z.string().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    source: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  people: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      subtitle: z.string().nullable().optional(),
      kind: z.literal('person'),
    }),
  ),
  companies: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      subtitle: z.string().nullable().optional(),
      kind: z.literal('company'),
    }),
  ),
  customFields: z.record(z.string(), z.unknown()),
  viewer: z.object({
    userId: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
})

const dealDetailErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch deal detail',
  methods: {
    GET: {
      summary: 'Fetch deal with associations',
      description: 'Returns a deal with linked people, companies, custom fields, and viewer context.',
      responses: [
        { status: 200, description: 'Deal detail payload', schema: dealDetailResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: dealDetailErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: dealDetailErrorSchema },
        { status: 404, description: 'Deal not found', schema: dealDetailErrorSchema },
      ],
    },
  },
}
