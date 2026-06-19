import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../data/entities'

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

  return NextResponse.json({
    items: (channels as CommunicationChannel[]).map(serialize),
    total: channels.length,
  })
}

function serialize(channel: CommunicationChannel) {
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
  return {
    id: channel.id,
    providerKey: channel.providerKey,
    channelType: channel.channelType,
    displayName: channel.displayName,
    externalIdentifier: channel.externalIdentifier ?? null,
    isPrimary: channel.isPrimary,
    isActive: channel.isActive,
    status: channel.status,
    lastError: channel.lastError ?? null,
    pollIntervalSeconds: channel.pollIntervalSeconds ?? null,
    lastPolledAt: channel.lastPolledAt?.toISOString?.() ?? null,
    pushStatus,
    lastPushError,
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
