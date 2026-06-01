import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../data/entities'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../../lib/access-control'
import {
  COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID,
  type DeleteChannelInput,
  type DeleteChannelResult,
} from '../../../../commands/delete-channel'
import { validateRouteMutationGuard } from '../../../../lib/route-mutation-guard'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

/**
 * Soft-delete (remove) a communication channel.
 *
 * Per-user access guard: only the channel owner — or an admin holding
 * `communication_channels.admin` — may delete a channel. Non-owners get a 404
 * (existence masking), consistent with the other channel routes. The declarative
 * `communication_channels.manage` feature gates the route itself; deletion is a
 * management operation alongside disconnect/set-primary.
 */
export const metadata = {
  path: '/communication_channels/channels/[id]',
  DELETE: {
    // Owner self-service: a user may disconnect their OWN personal mailbox
    // (gated by `connect_user_channel`). Deleting a shared/tenant-wide channel
    // still requires `manage` — enforced per channel type by
    // `assertCanManageChannel` in the handler.
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id,
      tenantId: auth.tenantId as string,
      organizationId,
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(auth.sub as string, {
      tenantId: auth.tenantId as string,
      organizationId,
    })
    userFeatures = acl?.isSuperAdmin ? ['*'] : Array.isArray(acl?.features) ? acl.features : []
  } catch {
    userFeatures = []
  }
  try {
    assertCanManageChannel(
      { userId: (channel as { userId?: string | null }).userId },
      auth.sub as string,
      userFeatures,
      'communication_channels.manage',
    )
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    throw err
  }

  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: id,
      operation: 'delete',
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus
  const input: DeleteChannelInput = {
    channelId: id,
    userId: auth.sub as string,
    scope: { tenantId: auth.tenantId as string, organizationId },
  }
  const { result } = await commandBus.execute<DeleteChannelInput, DeleteChannelResult>(
    COMMUNICATION_CHANNELS_DELETE_CHANNEL_COMMAND_ID,
    {
      input,
      ctx: {
        container,
        auth: auth as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    },
  )

  // 'noop' (channel vanished between the load and the command) and 'not_owner'
  // both map to 404 to avoid leaking ownership/existence.
  if (result.status !== 'deleted') {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  await guard.afterSuccess()
  return new NextResponse(null, { status: 204 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    DELETE: {
      summary: 'Delete (soft-delete) a communication channel',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 204, description: 'Channel deleted' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found or not owned by current user' },
      ],
    },
  },
}

export default DELETE
