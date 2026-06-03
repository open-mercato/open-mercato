import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID,
  type ToggleOutboundReactionInput,
  type ToggleOutboundReactionResult,
} from '../../../../../commands/toggle-outbound-reaction'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

const bodySchema = z.object({
  emoji: z.string().min(1).max(64),
})

export const metadata = {
  path: '/communication_channels/messages/[messageId]/reactions',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.react'],
  },
}

type RouteContext = {
  params: Promise<{ messageId: string }> | { messageId: string }
  auth?: {
    sub?: string
    tenantId?: string
    /**
     * AuthContext (`packages/shared/src/lib/auth/server.ts`) exposes the
     * selected organization as `orgId`, not `organizationId`. Round-2 F3 fix.
     */
    orgId?: string | null
  } | null
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { messageId } = await context.params
  if (!messageId || !z.string().uuid().safeParse(messageId).success) {
    return NextResponse.json({ error: 'Invalid messageId' }, { status: 400 })
  }

  const auth = context.auth
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
  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.message',
      resourceId: messageId,
      operation: 'custom',
      mutationPayload: body,
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus

  const input: ToggleOutboundReactionInput = {
    messageId,
    emoji: body.emoji,
    action: 'add',
    reactedByUserId: auth.sub,
    scope: {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    },
  }
  const { result } = await commandBus.execute<
    ToggleOutboundReactionInput,
    ToggleOutboundReactionResult
  >(COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID, {
    input,
    ctx: {
      container,
      auth: auth as never,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
    },
  })

  if (result.status === 'no_channel_link') {
    return NextResponse.json({ error: result.reason }, { status: 409 })
  }
  if (result.status === 'not_owner') {
    // Reacting would send from another user's connected account — refuse.
    return NextResponse.json({ error: result.reason }, { status: 403 })
  }
  if (result.status === 'noop') {
    return NextResponse.json({ error: result.reason }, { status: 409 })
  }
  if (result.status === 'added') {
    await guard.afterSuccess()
    return NextResponse.json(
      {
        id: result.reactionId,
        messageId: result.messageId,
        emoji: result.emoji,
        replaced: result.replaced,
        enqueued: result.enqueued,
      },
      { status: 201 },
    )
  }
  return NextResponse.json({ error: 'Unexpected result' }, { status: 500 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Add a reaction to a channel-linked message',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 201, description: 'Reaction added' },
        { status: 400, description: 'Invalid messageId' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Channel is owned by another user' },
        { status: 409, description: 'Message not channel-linked or duplicate reaction' },
        { status: 422, description: 'Invalid request body' },
      ],
    },
  },
}
export default POST
