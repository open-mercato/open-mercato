import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { generateWebhookSecret } from '@open-mercato/shared/lib/webhooks'
import { emitWebhooksEvent } from '../../../../events'
import { findScopedWebhook, json, resolveWebhookRequestScope } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['webhooks.secrets'] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const rotateSecretResponseSchema = z.object({
  success: z.literal(true),
  secret: z.string(),
  previousSecretSetAt: z.string().nullable(),
})

const errorSchema = z.object({ error: z.string() })

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const em = scope.em.fork()
  const webhook = await findScopedWebhook(em, scope, params.id)

  if (!webhook) {
    return json({ error: 'Webhook not found' }, { status: 404 })
  }

  webhook.previousSecret = webhook.secret
  webhook.previousSecretSetAt = new Date()
  webhook.secret = generateWebhookSecret()
  await em.flush()

  await emitWebhooksEvent('webhooks.secret.rotated', {
    webhookId: webhook.id,
    organizationId: webhook.organizationId,
    tenantId: webhook.tenantId,
  })

  return json({
    success: true,
    secret: webhook.secret,
    previousSecretSetAt: webhook.previousSecretSetAt?.toISOString() ?? null,
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Rotate webhook secret',
  description: 'Generates a new webhook signing secret and keeps the previous secret available for dual-sign verification.',
  methods: {
    POST: {
      summary: 'Rotate secret',
      description: 'Returns the new secret once. Store it immediately; future reads only expose a masked value.',
      pathParams: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'Secret rotated', schema: rotateSecretResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Webhook not found', schema: errorSchema },
      ],
    },
  },
}
