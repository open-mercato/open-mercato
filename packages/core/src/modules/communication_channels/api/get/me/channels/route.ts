import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../data/entities'
import { isHubPolledChannel } from '../../../../lib/polling-eligibility'
import type { ChannelAdapterRegistry } from '../../../../lib/registry'

export const metadata = {
  path: '/communication_channels/me/channels',
  GET: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

/**
 * List the current user's owned channels. Used by the profile page.
 *
 * Returns the user-scoped subset only (NOT tenant-wide channels). Admin views
 * of all channels live under `/api/communication_channels/channels` (slice 2e).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: auth.tenantId as string,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
      userId: auth.sub as string,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'desc' } },
    { tenantId: auth.tenantId as string, organizationId: (auth as { orgId?: string | null }).orgId ?? null },
  )

  // The profile grid renders "is this channel polled or push-driven?" and
  // "can push be registered here?" — both are adapter facts, not provider names,
  // so they are resolved server-side (#4980).
  let adapterRegistry: ChannelAdapterRegistry | null = null
  try {
    adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  } catch {
    adapterRegistry = null
  }

  return NextResponse.json({
    items: (channels as CommunicationChannel[]).map((channel) =>
      serialize(channel, adapterRegistry),
    ),
    total: channels.length,
  })
}

function serialize(channel: CommunicationChannel, adapterRegistry: ChannelAdapterRegistry | null) {
  // Spec C — expose push status + last push error to the operator UI so
  // the `PushStatusSection` can render the "Re-register push" affordance.
  const channelState =
    (channel.channelState as
      | { pushStatus?: string; lastPushError?: { code?: string; message?: string; at?: string } | null }
      | null) ?? null
  const pushStatus =
    typeof channelState?.pushStatus === 'string'
      ? (channelState.pushStatus as 'active' | 'inactive' | 'failed')
      : null
  const lastPushError =
    channelState?.lastPushError && typeof channelState.lastPushError === 'object'
      ? {
          code: channelState.lastPushError.code ?? null,
          message: channelState.lastPushError.message ?? null,
          at: channelState.lastPushError.at ?? null,
        }
      : null
  // `true` when the hub's poll worker skips this channel because the adapter
  // declares real-time push — the inverse of `isHubPolledChannel`, which the
  // worker itself uses, so the label cannot contradict the behaviour.
  const supportsRealtimePush = !isHubPolledChannel(channel.capabilities)
  const adapter = adapterRegistry?.get(channel.providerKey)
  const supportsPushRegistration = typeof adapter?.registerPush === 'function'
  return {
    id: channel.id,
    providerKey: channel.providerKey,
    channelType: channel.channelType,
    displayName: channel.displayName,
    externalIdentifier: channel.externalIdentifier ?? null,
    isPrimary: channel.isPrimary,
    /** Shared team mailbox flag; drives the profile-page share toggle. */
    visibility: channel.visibility === 'shared' ? 'shared' : 'private',
    /** Required so the share toggle can send the optimistic-lock header. */
    updatedAt: channel.updatedAt?.toISOString?.() ?? null,
    isActive: channel.isActive,
    status: channel.status,
    lastError: channel.lastError ?? null,
    pollIntervalSeconds: channel.pollIntervalSeconds ?? null,
    lastPolledAt: channel.lastPolledAt?.toISOString?.() ?? null,
    pushStatus,
    lastPushError,
    supportsRealtimePush,
    supportsPushRegistration,
    createdAt: channel.createdAt?.toISOString?.() ?? null,
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'List the current user\'s connected channels',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'List of user-owned channels' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
export default GET
