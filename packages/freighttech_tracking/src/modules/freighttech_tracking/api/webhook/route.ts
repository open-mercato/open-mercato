import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { decodeWebhookToken } from '../../lib/webhookToken'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['freighttech_tracking.webhook'] },
}

// Webhook callback_url endpoint
export async function POST(req: Request) {
  try {
    const { translate } = await resolveTranslations()
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    if (!token) {
      console.debug('[freighttech.webhook] Missing request token')
      return new CrudHttpError(401, { error: 'Missing token' })
    }

    const decoded = decodeWebhookToken(token)
    if (!decoded) {
      console.debug('[freighttech.webhook] Invalid request token')
      return new CrudHttpError(401, { error: 'Invalid token' })
    }

    const { organizationId, tenantId } = decoded
    const auth = await getAuthFromRequest(req)
    if (!auth || !organizationId || !tenantId) {
      throw new CrudHttpError(401, { error: translate('freighttech_tracking.settings.errors.unauthorized', 'Unauthorized') })
    }
    auth.orgId = organizationId
    auth.tenantId = tenantId

    // TODO: rest of the webhook implementation

    return NextResponse.json({})
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('freighttech_tracking.settings.put failed', err)
    return NextResponse.json(
      { error: translate('freighttech_tracking.settings.errors.save') },
      { status: 400 }
    )
  }
}

const PostSchema = z.object({
  // todo
})

const successSchema = z.object({})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Freighttech',
  summary: 'Freighttech Container Tracking webhook',
  methods: {
    POST: {
      summary: 'Push container data',
      requestBody: {
        contentType: 'application/json',
        schema: PostSchema,
      },
      responses: [
        { status: 200, description: 'Received data', schema: successSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 500, description: 'Server error', schema: errorSchema },
      ],
    },
  },
}
