import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID,
  type ToggleOutboundReactionInput,
  type ToggleOutboundReactionResult,
} from '../../../../../../commands/toggle-outbound-reaction'
import { MessageReaction } from '../../../../../../data/entities'
import { validateRouteMutationGuard } from '../../../../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/messages/[messageId]/reactions/[reactionId]',
  DELETE: {
    requireAuth: true,
    requireFeatures: ['communication_channels.react'],
  },
}

type RouteContext = {
  params: Promise<{ messageId: string; reactionId: string }> | { messageId: string; reactionId: string }
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

export async function DELETE(_req: Request, context: RouteContext): Promise<Response> {
  const { messageId, reactionId } = await context.params
  if (
    !messageId ||
    !reactionId ||
    !z.string().uuid().safeParse(messageId).success ||
    !z.string().uuid().safeParse(reactionId).success
  ) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  const auth = context.auth
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const reaction = await findOneWithDecryption(
    em,
    MessageReaction,
    {
      id: reactionId,
      messageId,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
  if (!reaction) {
    return NextResponse.json({ error: 'Reaction not found' }, { status: 404 })
  }

  const guard = await validateRouteMutationGuard({
    container,
    req: _req,
    auth,
    input: {
      resourceKind: 'communication_channels.message',
      resourceId: messageId,
      operation: 'custom',
      mutationPayload: { reactionId, emoji: reaction.emoji, action: 'remove' },
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus
  const input: ToggleOutboundReactionInput = {
    messageId,
    emoji: reaction.emoji,
    action: 'remove',
    reactionId,
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

  if (result.status === 'noop') {
    return NextResponse.json({ error: result.reason }, { status: 404 })
  }
  if (result.status === 'not_owner') {
    // The command's ownership gate runs before the remove branch too — surface it
    // as 403 (matching the POST reactions route) rather than a false 204 success.
    return NextResponse.json({ error: result.reason }, { status: 403 })
  }
  if (result.status === 'no_channel_link') {
    return NextResponse.json({ error: result.reason }, { status: 409 })
  }
  // 'removed'
  await guard.afterSuccess()
  return new NextResponse(null, { status: 204 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    DELETE: {
      summary: 'Remove a reaction from a channel-linked message',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 204, description: 'Reaction removed' },
        { status: 400, description: 'Invalid params' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Channel is owned by another user' },
        { status: 404, description: 'Reaction not found or not owned by current user' },
        { status: 409, description: 'Message not channel-linked' },
      ],
    },
  },
}
export default DELETE
