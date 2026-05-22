import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getFrontendRouteManifests } from '@open-mercato/shared/modules/registry'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { findOrganizationInTenant } from '@open-mercato/core/modules/customer_accounts/lib/organizationLookup'
import { buildPortalNav } from '@open-mercato/ui/portal/utils/nav'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

const navItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  labelKey: z.string().optional(),
  href: z.string(),
  icon: z.string().optional(),
  order: z.number(),
})

const navGroupSchema = z.object({
  id: z.enum(['main', 'account']),
  items: z.array(navItemSchema),
})

const navResponseSchema = z.object({
  ok: z.literal(true),
  orgSlug: z.string(),
  groups: z.array(navGroupSchema),
  grantedFeatures: z.array(z.string()),
  isPortalAdmin: z.boolean(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('customerRbacService') as CustomerRbacService
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const org = await findOrganizationInTenant(em, auth.orgId, auth.tenantId)
  const orgSlug = org?.slug ?? ''
  if (!orgSlug) {
    return NextResponse.json({ ok: false, error: 'Organization not found' }, { status: 404 })
  }

  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId, organizationId: auth.orgId })
  const grantedFeatures = acl.isPortalAdmin ? ['*'] : acl.features

  const groups = buildPortalNav({
    routes: getFrontendRouteManifests(),
    orgSlug,
    grantedFeatures,
    isPortalAdmin: acl.isPortalAdmin,
  })

  return NextResponse.json({
    ok: true,
    orgSlug,
    groups,
    grantedFeatures,
    isPortalAdmin: acl.isPortalAdmin,
  })
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Portal sidebar navigation',
  description:
    'Returns the portal sidebar for the authenticated customer. Items are derived from each portal page\'s `nav` metadata and filtered by `requireCustomerFeatures` against the customer\'s grants (wildcards honored).',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Portal sidebar groups', schema: navResponseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Organization not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Portal navigation',
  methods: { GET: getMethodDoc },
}
