import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

const requestSchema = z.object({
  features: z.array(z.string()).min(1).max(100),
})

export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  let body: z.infer<typeof requestSchema>
  try {
    const raw = await req.json()
    body = requestSchema.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
  const acl = await customerRbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  const granted = body.features.filter((feature) => authorizeFeatures([feature], {
    grantedFeatures: acl.features,
    unrestricted: acl.isPortalAdmin,
  }))

  return NextResponse.json({ ok: true, granted })
}

const methodDoc: OpenApiMethodDoc = {
  summary: 'Check customer portal feature access',
  description: 'Checks which of the requested features the authenticated customer user has. Used by portal menu injection for feature-gating.',
  tags: ['Customer Portal'],
  requestBody: {
    schema: requestSchema,
  },
  responses: [
    {
      status: 200,
      description: 'Feature check result',
      schema: z.object({
        ok: z.literal(true),
        granted: z.array(z.string()),
      }),
    },
  ],
  errors: [
    { status: 401, description: 'Not authenticated', schema: z.object({ ok: z.literal(false), error: z.string() }) },
    { status: 400, description: 'Invalid request', schema: z.object({ ok: z.literal(false), error: z.string() }) },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Portal feature check',
  methods: { POST: methodDoc },
}
