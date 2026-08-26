import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import {
  channelOrgScopeWhereFromFilter,
  channelOwnerScopeWhere,
} from '@open-mercato/core/modules/communication_channels/lib/access-control'
import { CHANNEL_DISCORD_VIEW_FEATURE } from '../../../lib/ai-features'
import { DISCORD_PROVIDER_KEY } from '../../../lib/channel-identity'
import { discordChannelStateSchema } from '../../../lib/credentials'

/**
 * Every Discord channel's AI auto-reply state in one call.
 *
 * The integration detail panel needs two booleans and an agent id per channel.
 * Asking the per-channel settings route for them meant one request per channel
 * *and* one full agent-registry load per request — 41 requests and 40 registry
 * loads to render 40 rows on a page operators land on. Nothing about that panel
 * needs the agent directory, so this route does not build one.
 *
 * The path is pinned in `metadata` rather than inferred from the file location,
 * the way `api/interactions/route.ts` pins its own: the sibling settings route
 * lives under `channels/[id]/`, and a collection endpoint that reads as a channel
 * id (`/channels/ai-auto-reply`) is a URL waiting to be mistaken for one.
 */
export const metadata = {
  path: '/channel_discord/ai-auto-reply/channels',
  GET: {
    requireAuth: true,
    requireFeatures: [CHANNEL_DISCORD_VIEW_FEATURE],
  },
}

/**
 * The panel lists a handful of bot channels; the cap is a guard against an
 * unbounded scan, not a paging contract. `truncated` tells the client when it is
 * looking at a partial list rather than letting it silently under-report.
 */
const MAX_CHANNELS = 200

export async function GET(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = await resolveOrganizationScopeForRequest({ container, auth: auth as never, request: req })
  const orgFilter = resolveOrganizationScopeFilter(scope, auth as never)

  // Same org scoping the hub's own channel list uses: a channel connected while
  // no organization was selected is stored with `organization_id IS NULL`, so an
  // equality filter on the caller's selected organization would hide exactly the
  // rows this panel is about (#5012).
  //
  // Ownership is scoped the way the hub's per-channel guards do rather than by a
  // hardcoded `userId: null` (#5602). Every route the product exposes for
  // connecting a Discord bot writes `user_id = auth.sub` — the connect widget
  // posts to the per-user credentials route, and the tenant-wide route refuses
  // Discord outright — so a shared-only filter matched nothing that can exist
  // and the panel, the feature's only entry point, was always empty. The clause
  // mirrors `assertCanAccessChannel` exactly, so widening the listing does not
  // widen access: another operator's personal channel stays invisible, and the
  // per-channel settings route still runs its own `manage` guard before anything
  // can be armed.
  //
  // Both fragments can carry an `$or`, so they are nested under `$and` — spread
  // side by side, the second would silently overwrite the first.
  const scopeClauses = [
    channelOrgScopeWhereFromFilter(orgFilter),
    channelOwnerScopeWhere(auth.sub as string),
  ].filter((clause) => Object.keys(clause).length > 0)

  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: auth.tenantId as string,
      providerKey: DISCORD_PROVIDER_KEY,
      ...(scopeClauses.length > 0 ? { $and: scopeClauses } : {}),
      deletedAt: null,
    },
    { limit: MAX_CHANNELS + 1, orderBy: { createdAt: 'desc' } },
    { tenantId: auth.tenantId as string, organizationId: orgFilter.rbacOrganizationId },
  )

  const truncated = channels.length > MAX_CHANNELS
  const items = (truncated ? channels.slice(0, MAX_CHANNELS) : channels).map((channel) => {
    const state = discordChannelStateSchema.safeParse(channel.channelState ?? {})
    return {
      channelId: channel.id,
      displayName: channel.displayName,
      aiAutoReplyEnabled: state.success ? Boolean(state.data.aiAutoReplyEnabled) : false,
      aiAgentId: (state.success ? state.data.aiAgentId : undefined) ?? null,
      aiAutoReplyLastError: (state.success ? state.data.aiAutoReplyLastError : undefined) ?? null,
      aiAutoReplyLastErrorAt: (state.success ? state.data.aiAutoReplyLastErrorAt : undefined) ?? null,
    }
  })

  return NextResponse.json({ items, truncated })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'List the AI auto-reply state of every Discord channel in scope',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'One row per Discord channel the caller may see' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
