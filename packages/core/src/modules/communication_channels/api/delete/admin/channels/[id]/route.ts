import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../../data/entities'
import {
  ChannelAccessDeniedError,
  assertCanManageChannel,
  channelOrgScopeWhere,
} from '../../../../../lib/access-control'
import {
  COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID,
  type AdminDeleteChannelInput,
  type AdminDeleteChannelResult,
} from '../../../../../commands/admin-delete-channel'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

/**
 * Admin soft-delete for a TENANT-WIDE communication channel (`user_id IS NULL`).
 *
 * Companion to `/communication_channels/channels/[id]` (owner-only, per-user
 * path). Tenant-wide channels — shared inboxes and the push providers
 * FCM/APNs/Expo — have no owner, so the owner route rejects them; this route
 * deletes them under `communication_channels.admin`. The channel is loaded
 * org-agnostically so tenant-wide `organization_id IS NULL` rows resolve from
 * any session org; per-user channels are masked as 404.
 */
export const metadata = {
  path: '/communication_channels/admin/channels/[id]',
  DELETE: {
    requireAuth: true,
    requireFeatures: ['communication_channels.admin'],
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
      ...channelOrgScopeWhere(organizationId),
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  // Mask a missing channel AND a per-user channel (which must go through the
  // owner path) as 404 so admins can't probe personal-mailbox existence.
  if (!channel || (channel as { userId?: string | null }).userId != null) {
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
  // Use the CHANNEL's own org (not the caller's session org) so push teardown
  // and credential resolution key where the channel stored them.
  const channelOrganizationId = (channel as { organizationId?: string | null }).organizationId ?? null
  const input: AdminDeleteChannelInput = {
    channelId: id,
    scope: { tenantId: auth.tenantId as string, organizationId: channelOrganizationId },
  }
  const { result } = await commandBus.execute<AdminDeleteChannelInput, AdminDeleteChannelResult>(
    COMMUNICATION_CHANNELS_ADMIN_DELETE_CHANNEL_COMMAND_ID,
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

  // 'noop' (channel vanished between the load and the command) and
  // 'not_tenant_wide' both map to 404 to avoid leaking existence.
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
      summary: 'Admin delete (soft-delete) a tenant-wide communication channel',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 204, description: 'Channel deleted' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found or not a tenant-wide channel' },
      ],
    },
  },
}

export default DELETE
