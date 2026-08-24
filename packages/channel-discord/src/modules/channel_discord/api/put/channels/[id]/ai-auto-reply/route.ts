import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { validateRouteMutationGuard } from '@open-mercato/core/modules/communication_channels/lib/route-mutation-guard'
import {
  CHANNEL_DISCORD_CHANNEL_RESOURCE_KIND,
  CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID,
  discordAiAutoReplySettingsSchema,
  type UpdateAiAutoReplyInput,
  type UpdateAiAutoReplyResult,
} from '../../../../../commands/update-ai-auto-reply'
import { isDiscordEligibleAgentId, listDiscordEligibleAgents } from '../../../../../lib/ai-agent-directory'
import { loadDiscordChannelForRequest } from '../../../../../lib/channel-access'
import { CHANNEL_DISCORD_CONFIGURE_FEATURE } from '../../../../../lib/ai-features'

export const metadata = {
  path: '/channel_discord/channels/[id]/ai-auto-reply',
  PUT: {
    requireAuth: true,
    requireFeatures: [CHANNEL_DISCORD_CONFIGURE_FEATURE],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function fieldError(field: string, message: string): Response {
  return NextResponse.json({ error: message, fieldErrors: { [field]: message } }, { status: 400 })
}

/**
 * Write a Discord channel's AI auto-reply settings — the configuration path the
 * subscriber was missing (issue #4778).
 *
 * The route is deliberately strict about *enabling*: it refuses to arm a channel
 * whose AI peer is absent, or to point one at an agent the runtime would reject.
 * Both would store a setting that can only fail later, inside a background
 * subscriber where nobody sees the error — which is precisely how the feature
 * ended up dormant in the first place.
 */
export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null

  const rawBody = await req.json().catch(() => null)
  if (rawBody == null || typeof rawBody !== 'object') {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const parsed = discordAiAutoReplySettingsSchema.safeParse(rawBody)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join('.') || 'aiAutoReplyEnabled'
    return fieldError(field, issue?.message ?? 'Invalid AI auto-reply settings')
  }

  if (parsed.data.aiAutoReplyEnabled) {
    const directory = await listDiscordEligibleAgents()
    if (!directory.available) {
      return fieldError(
        'aiAutoReplyEnabled',
        'channel_discord.aiAutoReply.errors.aiUnavailable',
      )
    }
    const agentId = parsed.data.aiAgentId as string
    if (!(await isDiscordEligibleAgentId(agentId))) {
      return fieldError('aiAgentId', 'channel_discord.aiAutoReply.errors.agentNotEligible')
    }
  }

  const container = await createRequestContainer()
  // Authorize before the guard so a caller who may not touch this channel gets a
  // masked 404 rather than a guard verdict about a record they cannot see.
  const access = await loadDiscordChannelForRequest({ container, req, auth, channelId: id, mode: 'manage' })
  if ('response' in access) return access.response

  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: CHANNEL_DISCORD_CHANNEL_RESOURCE_KIND,
      resourceId: id,
      operation: 'update',
      mutationPayload: { ...parsed.data },
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus
  const input: UpdateAiAutoReplyInput = {
    channelId: id,
    settings: parsed.data,
    scope: {
      tenantId: auth.tenantId as string,
      organizationId: access.rbacOrganizationId,
      organizationIds: access.organizationIds,
    },
  }

  let result: UpdateAiAutoReplyResult
  try {
    const executed = await commandBus.execute<UpdateAiAutoReplyInput, UpdateAiAutoReplyResult>(
      CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID,
      {
        input,
        ctx: {
          container,
          auth: auth as never,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: organizationId ? [organizationId] : null,
          request: req,
        },
      },
    )
    result = executed.result
  } catch (err) {
    // The optimistic-lock guard throws the shared structured 409 so the form's
    // conflict bar renders the same way it does anywhere else in the product.
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  await guard.afterSuccess()
  return NextResponse.json(
    {
      channelId: result.channelId,
      aiAutoReplyEnabled: result.aiAutoReplyEnabled,
      aiAgentId: result.aiAgentId,
      updatedAt: result.updatedAt,
    },
    { status: 200 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    PUT: {
      summary: "Update a Discord channel's AI auto-reply configuration",
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Settings stored' },
        { status: 400, description: 'Invalid payload, AI module absent, or agent not eligible' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found, or not a Discord channel in this scope' },
        { status: 409, description: 'The channel changed since the form was loaded' },
      ],
    },
  },
}

export default PUT
