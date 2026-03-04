import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createQueue } from '@open-mercato/queue'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getShippingAdapter } from '../../../../lib/adapter-registry'

const querySchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: false },
} as const

function normalizeHeaders(req: Request): Record<string, string | string[] | undefined> {
  const out: Record<string, string> = {}
  req.headers.forEach((value, key) => { out[key] = value })
  return out
}

export async function POST(req: Request, context: { params: Promise<{ provider: string }> }) {
  const params = await context.params
  const provider = params.provider?.trim().toLowerCase()
  if (!provider) return NextResponse.json({ error: 'Provider is required' }, { status: 400 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? '',
    organizationId: url.searchParams.get('organizationId') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'tenantId and organizationId are required query parameters' }, { status: 422 })
  }

  const adapter = getShippingAdapter(provider)
  if (!adapter) return NextResponse.json({ error: `Unsupported provider '${provider}'` }, { status: 422 })

  const container = await createRequestContainer()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }

  const credentials = await integrationCredentials.resolve(`carrier_${provider}`, {
    tenantId: parsed.data.tenantId,
    organizationId: parsed.data.organizationId,
  })

  const rawBody = await req.text()
  let verifiedEvent
  try {
    verifiedEvent = await adapter.verifyWebhook({
      rawBody,
      headers: normalizeHeaders(req),
      credentials: credentials ?? {},
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Webhook verification failed' }, { status: 401 })
  }

  const strategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queue = createQueue('shipping-carriers-webhook', strategy)
  await queue.enqueue({
    provider,
    tenantId: parsed.data.tenantId,
    organizationId: parsed.data.organizationId,
    verifiedEvent,
  })

  return NextResponse.json({ ok: true }, { status: 202 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Shipping Carriers',
  summary: 'Carrier webhook endpoint',
  methods: {
    POST: {
      query: querySchema,
      responses: [{ status: 202, description: 'Accepted' }],
      errors: [{ status: 401, description: 'Invalid signature' }, { status: 422, description: 'Invalid request' }],
    },
  },
}
