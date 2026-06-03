import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../../data/entities'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../../../lib/access-control'
import { refreshCredentialsIfNeeded } from '../../../../../lib/credential-refresh'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export const metadata = {
  path: '/communication_channels/channels/[id]/test-send',
  POST: {
    // Owner self-service: a user may send a test from their OWN mailbox (gated
    // by `connect_user_channel`). Test-sending from a shared/tenant-wide channel
    // still requires `manage` — enforced per channel type by `assertCanManageChannel`.
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

const bodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().max(50_000).optional(),
})

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

/**
 * Admin diagnostic — send a test message via the adapter without creating a
 * platform `Message`. Useful for verifying credentials + outbound connectivity
 * after a channel is configured.
 *
 * The result is NOT persisted to `ExternalMessage` / `MessageChannelLink` — it
 * is a one-shot probe.
 */
export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await readJsonSafe(req, null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id,
      tenantId: auth.tenantId as string,
      organizationId,
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  // Load features via RBAC service so admin bypass (`communication_channels.admin`,
  // wildcards, super-admin) is honoured. The `auth` object from
  // `getAuthFromRequest` carries identity only — feature ACLs live in the RBAC
  // service and must be loaded per request.
  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(auth.sub as string, {
      tenantId: auth.tenantId as string,
      organizationId,
    })
    userFeatures = acl?.isSuperAdmin ? ['*'] : Array.isArray(acl?.features) ? acl.features : []
  } catch {
    userFeatures = []
  }
  try {
    assertCanManageChannel(
      { userId: channel.userId },
      auth.sub as string,
      userFeatures,
      'communication_channels.manage',
    )
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    const status = (err as { statusCode?: number }).statusCode ?? 403
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Access denied' },
      { status },
    )
  }
  if (!channel.isActive || channel.status !== 'connected') {
    return NextResponse.json(
      { error: `Channel is in status '${channel.status}' (not connected)` },
      { status: 409 },
    )
  }

  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: channel.id,
      operation: 'custom',
      mutationPayload: body as unknown as Record<string, unknown>,
    },
  })
  if ('response' in guard) return guard.response

  const adapter = getChannelAdapter(channel.providerKey)
  if (!adapter) {
    return NextResponse.json(
      { error: `No adapter registered for provider '${channel.providerKey}'` },
      { status: 404 },
    )
  }

  // Resolve credentials + optionally refresh.
  let credentials: Record<string, unknown> = {}
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    credentialsService = null
  }
  if (channel.credentialsRef && credentialsService) {
    credentials =
      (await credentialsService
        .resolve(`channel_${channel.providerKey}`, {
          tenantId: auth.tenantId as string,
          organizationId: organizationId ?? (auth.tenantId as string),
          userId: channel.userId ?? null,
        })
        .catch(() => null)) ?? {}
  }
  const credentialScope = {
    tenantId: auth.tenantId as string,
    organizationId: organizationId ?? (auth.tenantId as string),
    userId: channel.userId ?? null,
  }
  const refreshed = await refreshCredentialsIfNeeded(
    {
      adapter,
      channelId: channel.id,
      credentials,
      scope: credentialScope,
    },
    { credentialsService },
  )
  credentials = refreshed.credentials

  try {
    const converted = await adapter.convertOutbound({
      body: body.body ?? 'Test message from Open Mercato',
      bodyFormat: 'text',
    })
    const result = await adapter.sendMessage({
      content: converted.content,
      credentials,
      scope: {
        tenantId: auth.tenantId as string,
        organizationId: organizationId ?? (auth.tenantId as string),
      },
      metadata: { to: body.to, subject: body.subject ?? 'Test send', testSend: true },
    })
    await guard.afterSuccess()
    return NextResponse.json({
      status: result.status,
      externalMessageId: result.externalMessageId,
      providerError: result.error ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send failed'
    return NextResponse.json({ status: 'failed', error: message }, { status: 502 })
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Diagnostic — send a test message through the channel without persisting',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Test send result' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Not allowed to manage this channel' },
        { status: 404, description: 'Channel or adapter not found' },
        { status: 409, description: 'Channel not connected' },
        { status: 422, description: 'Invalid request body' },
        { status: 502, description: 'Provider error' },
      ],
    },
  },
}
export default POST
