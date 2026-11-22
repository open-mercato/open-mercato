import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import { resolveOAuthClientCredentials } from '../../../../../lib/oauth-client-config'

export const metadata = {
  path: '/communication_channels/oauth/[provider]/status',
  GET: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

const providerKeySchema = z.string().regex(/^[a-z0-9_-]+$/i)

type RouteContext = {
  params: Promise<{ provider: string }> | { provider: string }
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = providerKeySchema.safeParse((await context.params).provider)
  if (!provider.success) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  }

  const adapter = getChannelAdapter(provider.data)
  if (typeof adapter?.buildOAuthAuthorizeUrl !== 'function') {
    return NextResponse.json({ error: 'OAuth provider unavailable' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const service = container.resolve<Parameters<typeof resolveOAuthClientCredentials>[0]>(
    'integrationCredentialsService',
    { allowUnregistered: true },
  )
  const credentials = await resolveOAuthClientCredentials(service, provider.data, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  const configured =
    typeof credentials?.clientId === 'string' && credentials.clientId.trim().length > 0 &&
    typeof credentials.clientSecret === 'string' && credentials.clientSecret.trim().length > 0

  return NextResponse.json({ configured }, { headers: { 'Cache-Control': 'no-store' } })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'Read the current workspace OAuth client setup status',
      responses: [
        { status: 200, description: 'Whether the workspace has saved OAuth client credentials' },
        { status: 400, description: 'Invalid provider' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Mailbox connection forbidden' },
        { status: 404, description: 'OAuth provider unavailable' },
      ],
    },
  },
}
export default GET
