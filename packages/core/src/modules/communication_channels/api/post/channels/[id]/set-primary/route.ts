import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID,
  type SetPrimaryChannelInput,
  type SetPrimaryChannelResult,
} from '../../../../../commands/set-primary-channel'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/channels/[id]/set-primary',
  POST: {
    // Owner self-service: every email user controls their own channels. The
    // set-primary command enforces strict ownership (`not_owner` → 404), and
    // "primary" only applies to per-user channels, so `connect_user_channel`
    // is the correct gate (not `manage`).
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: id,
      operation: 'custom',
      mutationPayload: { isPrimary: true },
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus

  const input: SetPrimaryChannelInput = {
    channelId: id,
    userId: auth.sub as string,
    scope: {
      tenantId: auth.tenantId as string,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    },
  }
  const { result } = await commandBus.execute<
    SetPrimaryChannelInput,
    SetPrimaryChannelResult
  >(COMMUNICATION_CHANNELS_SET_PRIMARY_COMMAND_ID, {
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

  // Non-ownership maps to 404 (existence masking), consistent with the other
  // channel-scoped routes (GET [id], poll-now, import-history, test-send, DELETE).
  if (result.status === 'not_owner') {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  if (result.status === 'noop') {
    return NextResponse.json({ channelId: id, isPrimary: true, unchanged: true }, { status: 200 })
  }
  await guard.afterSuccess()
  return NextResponse.json(
    {
      channelId: result.channelId,
      isPrimary: true,
      previousPrimaryChannelId: result.previousPrimaryChannelId,
    },
    { status: 200 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Mark a per-user channel as primary',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Channel set as primary (or already primary)' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found or not owned by current user' },
      ],
    },
  },
}
export default POST
