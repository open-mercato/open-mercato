import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerLead } from '../../../data/entities'
import { E } from '#generated/entities.ids.generated'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }): Promise<Response> {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return notFound('Lead not found')
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
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.leads.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return forbidden('Access denied')
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = (container.resolve('em') as EntityManager)

  const lead = await findOneWithDecryption(
    em,
    CustomerLead,
    { id: parsedParams.data.id, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )
  if (!lead) {
    return notFound('Lead not found')
  }

  if (auth.tenantId && lead.tenantId && auth.tenantId !== lead.tenantId) {
    return notFound('Lead not found')
  }

  const allowedOrgIds = new Set<string>()
  if (Array.isArray(scope?.filterIds)) {
    scope.filterIds.forEach((id) => {
      if (typeof id === 'string' && id.trim().length) allowedOrgIds.add(id)
    })
  } else if (auth.orgId) {
    allowedOrgIds.add(auth.orgId)
  }
  if (allowedOrgIds.size && lead.organizationId && !allowedOrgIds.has(lead.organizationId)) {
    return forbidden('Access denied')
  }

  return NextResponse.json({
    id: lead.id,
    title: lead.title,
    description: lead.description ?? null,
    status: lead.status,
    source: lead.source ?? null,
    estimatedValueAmount: lead.estimatedValueAmount ?? null,
    estimatedValueCurrency: lead.estimatedValueCurrency ?? null,
    companyName: lead.companyName ?? null,
    companyVatId: lead.companyVatId ?? null,
    contactFirstName: lead.contactFirstName ?? null,
    contactLastName: lead.contactLastName ?? null,
    contactPhone: lead.contactPhone ?? null,
    contactEmail: lead.contactEmail ?? null,
    createdDealId: lead.createdDealId ?? null,
    createdPersonEntityId: lead.createdPersonEntityId ?? null,
    createdCompanyEntityId: lead.createdCompanyEntityId ?? null,
    convertedAt: lead.convertedAt ? lead.convertedAt.toISOString() : null,
    convertedByUserId: lead.convertedByUserId ?? null,
    organizationId: lead.organizationId ?? null,
    tenantId: lead.tenantId ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  })
}

const leadDetailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  estimatedValueAmount: z.number().nullable().optional(),
  estimatedValueCurrency: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyVatId: z.string().nullable().optional(),
  contactFirstName: z.string().nullable().optional(),
  contactLastName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  createdDealId: z.string().uuid().nullable().optional(),
  createdPersonEntityId: z.string().uuid().nullable().optional(),
  createdCompanyEntityId: z.string().uuid().nullable().optional(),
  convertedAt: z.string().nullable().optional(),
  convertedByUserId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const leadDetailErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch lead detail',
  methods: {
    GET: {
      summary: 'Fetch lead detail',
      description: 'Returns a lead with all candidate fields and conversion lineage.',
      responses: [
        { status: 200, description: 'Lead detail payload', schema: leadDetailResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: leadDetailErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: leadDetailErrorSchema },
        { status: 404, description: 'Lead not found', schema: leadDetailErrorSchema },
      ],
    },
  },
}
