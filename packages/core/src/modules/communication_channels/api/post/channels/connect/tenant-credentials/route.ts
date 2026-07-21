import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
  type ConnectCredentialChannelInput,
  type ConnectCredentialChannelResult,
} from '../../../../../commands/connect-credential-channel'
import type { ChannelAdapterRegistry } from '../../../../../lib/registry'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/channels/connect/tenant-credentials',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_tenant_channel'],
  },
}

const bodySchema = z.object({
  providerKey: z.string().min(1).max(64),
  displayName: z.string().min(1).max(255),
  credentials: z.record(z.string(), z.unknown()),
  pollIntervalSeconds: z.number().int().positive().max(86_400).optional(),
})

export async function POST(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const json = await readJsonSafe(req, null)
    body = bodySchema.parse(json)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()

  // Reject providers that are NOT tenant-scoped so an admin can't force a
  // per-user provider (Gmail/IMAP) into a shared tenant-wide channel. Push
  // providers (FCM/APNs/Expo) declare `channelScope: 'tenant'` on their adapter.
  const adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  const adapter = adapterRegistry.get(body.providerKey)
  if (!adapter) {
    return NextResponse.json(
      { error: `No adapter registered for provider '${body.providerKey}'` },
      { status: 404 },
    )
  }
  if (adapter.channelScope !== 'tenant') {
    return NextResponse.json(
      {
        error: 'This provider connects per-user channels; use the personal channel connect flow instead.',
        code: 'provider_not_tenant_scoped',
      },
      { status: 400 },
    )
  }

  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: `new:${body.providerKey}`,
      operation: 'create',
      mutationPayload: {
        providerKey: body.providerKey,
        displayName: body.displayName,
        pollIntervalSeconds: body.pollIntervalSeconds,
      },
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus
  const orgId = (auth as { orgId?: string | null }).orgId ?? null

  const input: ConnectCredentialChannelInput = {
    providerKey: body.providerKey,
    displayName: body.displayName,
    credentials: body.credentials,
    pollIntervalSeconds: body.pollIntervalSeconds,
    // Tenant-wide: no owning user. The command re-derives the effective scope
    // from the adapter, so the channel + credentials are stored with user_id NULL.
    userId: null,
    scope: {
      tenantId: auth.tenantId as string,
      organizationId: orgId,
    },
  }
  const { result } = await commandBus.execute<
    ConnectCredentialChannelInput,
    ConnectCredentialChannelResult
  >(COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID, {
    input,
    ctx: {
      container,
      auth: auth as never,
      organizationScope: null,
      selectedOrganizationId: orgId,
      organizationIds: orgId ? [orgId] : null,
    },
  })

  if (result.status === 'no_adapter') {
    return NextResponse.json({ error: result.reason }, { status: 404 })
  }
  if (result.status === 'wrong_scope_for_route') {
    // Unreachable in practice — this route always dispatches with userId: null —
    // but handle it so the result union narrows and the invariant is explicit.
    return NextResponse.json(
      { error: 'Unexpected per-user scope on the tenant connect route.', code: 'wrong_scope_for_route' },
      { status: 500 },
    )
  }
  if (result.status === 'validation_failed') {
    return NextResponse.json({ error: 'Credential validation failed', fieldErrors: result.errors }, { status: 422 })
  }
  if (result.status === 'duplicate_mailbox') {
    return NextResponse.json(
      {
        error: `This mailbox is already connected via "${result.existingProviderKey}". Disconnect it there before connecting it again with a different provider.`,
        code: 'mailbox_already_connected',
      },
      { status: 409 },
    )
  }
  await guard.afterSuccess()
  return NextResponse.json(
    {
      channelId: result.channelId,
      externalIdentifier: result.externalIdentifier,
    },
    { status: 201 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Connect a tenant-wide credential-based channel (push: FCM/APNs/Expo)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 201, description: 'Channel connected' },
        { status: 400, description: 'Provider is not tenant-scoped' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Unknown provider' },
        { status: 422, description: 'Invalid body or credential validation failed' },
      ],
    },
  },
}
export default POST
