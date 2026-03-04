import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createQueue } from '@open-mercato/queue'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { verifyGatewayWebhook } from '../../../../lib/payment-gateway-service'
import { resolveGatewayWebhookQueue } from '../../../../lib/webhook-registry'

const querySchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: false },
} as const

function normalizeHeaders(req: Request): Record<string, string | string[] | undefined> {
  const output: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    output[key] = value
  })
  return output
}

export async function POST(req: Request, context: { params: Promise<{ provider: string }> }) {
  const params = await context.params
  const provider = params.provider?.trim().toLowerCase()
  if (!provider) return NextResponse.json({ error: 'Provider is required' }, { status: 400 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({
    tenantId: url.searchParams.get('tenantId') ?? '',
    organizationId: url.searchParams.get('organizationId') ?? '',
  })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'tenantId and organizationId query params are required' }, { status: 422 })
  }

  const rawBody = await req.text()
  const headers = normalizeHeaders(req)

  const container = await createRequestContainer()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }

  const integrationId = `gateway_${provider}`
  const credentials = await integrationCredentials.resolve(integrationId, {
    tenantId: parsedQuery.data.tenantId,
    organizationId: parsedQuery.data.organizationId,
  })

  let event
  try {
    event = await verifyGatewayWebhook(provider, {
      rawBody,
      headers,
      settings: credentials ?? {},
    }, '2024-12-18')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook verification failed'
    return NextResponse.json({ error: message }, { status: 401 })
  }

  const queueName = resolveGatewayWebhookQueue(provider)
  const strategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
  const queue = createQueue(queueName, strategy)

  await queue.enqueue({
    provider,
    tenantId: parsedQuery.data.tenantId,
    organizationId: parsedQuery.data.organizationId,
    verifiedEvent: event,
    settings: credentials ?? {},
  })

  return NextResponse.json({ ok: true, queue: queueName }, { status: 202 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payment Gateways',
  summary: 'Receive provider webhook',
  methods: {
    POST: {
      query: querySchema,
      responses: [{ status: 202, description: 'Accepted' }],
      errors: [
        { status: 401, description: 'Invalid signature' },
        { status: 422, description: 'Missing required scope query parameters' },
      ],
    },
  },
}
