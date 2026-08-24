import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { discordChannelStateSchema } from '../../../../../lib/credentials'
import { listDiscordEligibleAgents } from '../../../../../lib/ai-agent-directory'
import { loadDiscordChannelForRequest } from '../../../../../lib/channel-access'
import { CHANNEL_DISCORD_VIEW_FEATURE } from '../../../../../lib/ai-features'
import { CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../../../../../ai-agents'

export const metadata = {
  path: '/channel_discord/channels/[id]/ai-auto-reply',
  GET: {
    requireAuth: true,
    requireFeatures: [CHANNEL_DISCORD_VIEW_FEATURE],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

/**
 * Read a Discord channel's AI auto-reply settings plus everything the settings
 * form needs to render itself: the eligible agents, whether the optional AI peer
 * is installed at all, and the channel's `updatedAt` so the form can attach the
 * optimistic-lock header on save.
 */
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const access = await loadDiscordChannelForRequest({ container, req, auth, channelId: id, mode: 'read' })
  if ('response' in access) return access.response
  const { channel } = access

  const state = discordChannelStateSchema.safeParse(channel.channelState ?? {})
  const directory = await listDiscordEligibleAgents()

  return NextResponse.json({
    id: channel.id,
    channelId: channel.id,
    displayName: channel.displayName,
    updatedAt: channel.updatedAt ? channel.updatedAt.toISOString() : null,
    aiAutoReplyEnabled: state.success ? Boolean(state.data.aiAutoReplyEnabled) : false,
    aiAgentId: (state.success ? state.data.aiAgentId : undefined) ?? null,
    defaultAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
    aiAvailable: directory.available,
    agents: directory.available ? directory.agents : [],
  })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: "Read a Discord channel's AI auto-reply configuration",
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Current settings plus the agents this channel may be pointed at' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found, not a Discord channel in scope, or not the caller’s to see' },
      ],
    },
  },
}

export default GET
