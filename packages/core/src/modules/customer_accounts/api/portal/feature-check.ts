import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { hasAllFeatures, matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'

export const metadata: { path?: string } = {}

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

  const granted = body.features.filter((feature) =>
    auth.resolvedFeatures.some((g) => matchFeature(feature, g)),
  )

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
