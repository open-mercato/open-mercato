import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { validateRouteMutationGuard } from '@open-mercato/core/modules/communication_channels/lib/route-mutation-guard'
import { CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../../../../ai-agents'
import {
  CHANNEL_DISCORD_CHANNEL_RESOURCE_KIND,
  CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID,
  discordAiAutoReplySettingsSchema,
  type UpdateAiAutoReplyInput,
  type UpdateAiAutoReplyResult,
} from '../../../../commands/update-ai-auto-reply'
import {
  findDiscordEligibleAgent,
  listDiscordEligibleAgents,
  missingAgentFeatures,
  type AgentInvokingPrincipal,
} from '../../../../lib/ai-agent-directory'
import { CHANNEL_DISCORD_CONFIGURE_FEATURE, CHANNEL_DISCORD_VIEW_FEATURE } from '../../../../lib/ai-features'
import { resolveDiscordAiPrincipal } from '../../../../lib/ai-service-principal'
import { loadDiscordChannelForRequest } from '../../../../lib/channel-access'
import { discordChannelStateSchema } from '../../../../lib/credentials'

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: [CHANNEL_DISCORD_VIEW_FEATURE],
  },
  PUT: {
    requireAuth: true,
    requireFeatures: [CHANNEL_DISCORD_CONFIGURE_FEATURE],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function fieldError(field: string, message: string, extra?: Record<string, unknown>): Response {
  return NextResponse.json(
    { error: message, fieldErrors: { [field]: message }, ...extra },
    { status: 400 },
  )
}

/**
 * The identity the auto-reply subscriber will run the chosen agent under, so both
 * methods can answer "would the runtime accept this?" with the same grants the
 * subscriber will present — the tenant's channel-bot user when it exists, the
 * provider service principal otherwise.
 */
async function loadInvokingPrincipal(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string | null },
): Promise<AgentInvokingPrincipal> {
  const em = (container.resolve('em') as EntityManager).fork()
  return resolveDiscordAiPrincipal({
    em,
    resolver: { resolve: <T,>(name: string): T => container.resolve(name) as T },
    scope,
  })
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

  // Every offered agent carries whether the auto-reply principal could actually
  // invoke it. Without this the picker offers agents from other modules that the
  // runtime will refuse, and the refusal only ever happens later in a background
  // subscriber — so the operator sees "Auto-reply on" and silence.
  const principal = directory.available
    ? await loadInvokingPrincipal(container, {
      tenantId: auth.tenantId as string,
      organizationId: access.rbacOrganizationId,
    })
    : null
  const agents = directory.available && principal
    ? directory.agents.map((agent) => {
      const missingFeatures = missingAgentFeatures(agent.requiredFeatures, principal)
      return { ...agent, invocable: missingFeatures.length === 0, missingFeatures }
    })
    : []

  return NextResponse.json({
    id: channel.id,
    channelId: channel.id,
    displayName: channel.displayName,
    updatedAt: channel.updatedAt ? channel.updatedAt.toISOString() : null,
    aiAutoReplyEnabled: state.success ? Boolean(state.data.aiAutoReplyEnabled) : false,
    aiAgentId: (state.success ? state.data.aiAgentId : undefined) ?? null,
    // Why the last attempt produced nothing, so an armed channel that answers
    // nothing says so instead of looking healthy.
    aiAutoReplyLastError: (state.success ? state.data.aiAutoReplyLastError : undefined) ?? null,
    aiAutoReplyLastErrorAt: (state.success ? state.data.aiAutoReplyLastErrorAt : undefined) ?? null,
    defaultAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
    aiAvailable: directory.available,
    agents,
  })
}

/**
 * Write a Discord channel's AI auto-reply settings — the configuration path the
 * subscriber was missing (issue #4778).
 *
 * The route is deliberately strict about *enabling*: it refuses to arm a channel
 * whose AI peer is absent, one pointed at an agent the runtime would reject on
 * shape, and one pointed at an agent the auto-reply principal is not authorized
 * to invoke. All three would store a setting that can only fail later, inside a
 * background subscriber where nobody sees the error — which is precisely how the
 * feature ended up dormant in the first place. The three checks mirror, in order,
 * what `runAiAgentObject` → `checkAgentPolicy` will ask at run time.
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

  const container = await createRequestContainer()
  // Authorize before the guard so a caller who may not touch this channel gets a
  // masked 404 rather than a guard verdict about a record they cannot see. It
  // also comes before the arming checks below, which need the channel's resolved
  // organization to build the principal they judge the agent against.
  const access = await loadDiscordChannelForRequest({ container, req, auth, channelId: id, mode: 'manage' })
  if ('response' in access) return access.response

  if (parsed.data.aiAutoReplyEnabled) {
    const agentId = parsed.data.aiAgentId as string
    const agent = await findDiscordEligibleAgent(agentId)
    if (!agent) {
      // No eligible agent under this id: either the optional AI peer is absent, or
      // the agent is not object-mode and `runAiAgentObject` would reject it.
      const directory = await listDiscordEligibleAgents()
      return directory.available
        ? fieldError('aiAgentId', 'channel_discord.aiAutoReply.errors.agentNotEligible')
        : fieldError('aiAutoReplyEnabled', 'channel_discord.aiAutoReply.errors.aiUnavailable')
    }

    // Shape is not authorization. `checkAgentPolicy` enforces the agent's
    // `requiredFeatures` against the auto-reply principal at run time, so arming a
    // channel against an agent that principal cannot invoke stores a setting that
    // can only fail later — inside a background subscriber, where the operator
    // never sees it. Refuse here, naming the grants the tenant's channel-bot user
    // is missing, rather than accepting a channel that would answer nothing.
    const principal = await loadInvokingPrincipal(container, {
      tenantId: auth.tenantId as string,
      organizationId: access.rbacOrganizationId,
    })
    const missingFeatures = missingAgentFeatures(agent.requiredFeatures, principal)
    if (missingFeatures.length > 0) {
      return fieldError(
        'aiAgentId',
        'channel_discord.aiAutoReply.errors.agentFeaturesMissing',
        { missingFeatures },
      )
    }
  }

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
    PUT: {
      summary: "Update a Discord channel's AI auto-reply configuration",
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Settings stored' },
        {
          status: 400,
          description:
            'Invalid payload, AI module absent, agent not eligible, or the auto-reply principal lacks the agent’s required features',
        },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found, or not a Discord channel in this scope' },
        { status: 409, description: 'The channel changed since the form was loaded' },
      ],
    },
  },
}
