import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
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
const statusHeaders = { 'Cache-Control': 'no-store' }

type RouteContext = {
  params: Promise<{ provider: string }> | { provider: string }
  auth: AuthContext
}

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { auth } = context
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
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const rbac = container.resolve<Pick<RbacService, 'userHasAllFeatures'>>('rbacService')
  const canConnect = await rbac.userHasAllFeatures(auth.sub, metadata.GET.requireFeatures, scope)
  if (!canConnect) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: statusHeaders })
  }

  const service = container.resolve<Parameters<typeof resolveOAuthClientCredentials>[0]>(
    'integrationCredentialsService',
    { allowUnregistered: true },
  )
  let credentials: Awaited<ReturnType<typeof resolveOAuthClientCredentials>>
  try {
    credentials = await resolveOAuthClientCredentials(
      service, provider.data, scope, { failOnReadError: true, requireComplete: true },
    )
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'communication_channels',
      code: 'communication_channels.oauth_client_status_unavailable',
    })
    return NextResponse.json({ error: 'OAuth client status unavailable' }, { status: 503, headers: statusHeaders })
  }
  return NextResponse.json({ configured: credentials !== null }, { headers: statusHeaders })
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
        { status: 503, description: 'OAuth client status temporarily unavailable' },
      ],
    },
  },
}
export default GET
