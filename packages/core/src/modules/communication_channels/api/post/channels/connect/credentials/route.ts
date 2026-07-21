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
  path: '/communication_channels/channels/connect/credentials',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
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

  // Tenant-scoped providers (push: FCM/APNs/Expo) must go through the admin-gated
  // tenant route, not this per-user one (granted to manager/employee via
  // `connect_user_channel`). Reject them here so a non-admin can't mint a
  // privileged tenant-wide channel. The command enforces the same invariant
  // (`wrong_scope_for_route`) as defense-in-depth.
  const adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  const earlyAdapter = adapterRegistry.get(body.providerKey)
  if (earlyAdapter && earlyAdapter.channelScope === 'tenant') {
    return NextResponse.json(
      {
        error: 'This provider is connected tenant-wide by an administrator, not per-user.',
        code: 'provider_is_tenant_scoped',
      },
      { status: 403 },
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

  const input: ConnectCredentialChannelInput = {
    providerKey: body.providerKey,
    displayName: body.displayName,
    credentials: body.credentials,
    pollIntervalSeconds: body.pollIntervalSeconds,
    userId: auth.sub as string,
    scope: {
      tenantId: auth.tenantId as string,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
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
      selectedOrganizationId: (auth as { orgId?: string | null }).orgId ?? null,
      organizationIds: (auth as { orgId?: string | null }).orgId
        ? [(auth as { orgId?: string | null }).orgId!]
        : null,
    },
  })

  if (result.status === 'no_adapter') {
    return NextResponse.json({ error: result.reason }, { status: 404 })
  }
  if (result.status === 'wrong_scope_for_route') {
    return NextResponse.json(
      {
        error: 'This provider is connected tenant-wide by an administrator, not per-user.',
        code: 'provider_is_tenant_scoped',
      },
      { status: 403 },
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
      summary: 'Connect a credential-based per-user channel (IMAP/SMTP)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 201, description: 'Channel connected' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Provider is tenant-scoped — use the tenant connect route' },
        { status: 404, description: 'Unknown provider' },
        { status: 409, description: 'Mailbox already connected via another provider' },
        { status: 422, description: 'Invalid body or credential validation failed' },
      ],
    },
  },
}
export default POST
