import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const features: string[] = Array.isArray(body?.features) ? body.features : []
  if (!features.length) return NextResponse.json({ ok: true, granted: [], userId: auth.sub })
  const container = await createRequestContainer()
  const rbac = (container.resolve('rbacService') as any)
  const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
  // Return which features the user has (for batch checking)
  if (ok) {
    return NextResponse.json({ ok: true, granted: features, userId: auth.sub })
  }
  // Check individually to see which features are granted
  const granted: string[] = []
  for (const f of features) {
    const hasFeature = await rbac.userHasAllFeatures(auth.sub, [f], { tenantId: auth.tenantId, organizationId: auth.orgId })
    if (hasFeature) granted.push(f)
  }
  return NextResponse.json({ ok: false, granted, userId: auth.sub })
}

const featureCheckRequestSchema = z.object({
  features: z.array(z.string()).describe('Feature identifiers to check'),
}).describe('Batch feature check payload')

const featureCheckResponseSchema = z.object({
  ok: z.boolean().describe('Indicates whether all requested features are granted'),
  granted: z.array(z.string()).describe('Features the current user may access'),
  userId: z.string().describe('Identifier of the authenticated user'),
})

const featureCheckMethodDoc: OpenApiMethodDoc = {
  summary: 'Check feature grants for the current user',
  description: 'Evaluates which of the requested features are available to the signed-in user within the active tenant / organization context.',
  tags: ['Authentication & Accounts'],
  requestBody: {
    contentType: 'application/json',
    schema: featureCheckRequestSchema,
    description: 'Feature identifiers to evaluate.',
  },
  responses: [
    {
      status: 200,
      description: 'Evaluation result',
      schema: featureCheckResponseSchema,
    },
  ],
  errors: [
    {
      status: 401,
      description: 'Authentication required',
      schema: z.object({ ok: z.literal(false), error: z.string() }),
    },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Check feature grants for the current user',
  methods: {
    POST: featureCheckMethodDoc,
  },
}
