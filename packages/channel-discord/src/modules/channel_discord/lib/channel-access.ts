import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import {
  assertCanAccessChannel,
  assertCanManageChannel,
  channelOrgScopeWhereFromFilter,
  ChannelAccessDeniedError,
} from '@open-mercato/core/modules/communication_channels/lib/access-control'

type RouteAuth = {
  sub?: string | null
  tenantId?: string | null
  orgId?: string | null
}

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export type DiscordChannelAccess = {
  channel: CommunicationChannel
  /** Organizations the caller may see, for the command's own scoped re-lookup. */
  organizationIds: string[] | null
  /** Organization the decryption scope is anchored to. */
  rbacOrganizationId: string | null
}

/**
 * Load a Discord channel for a provider-owned route, scoped and authorized the
 * same way the hub's own channel-scoped routes do.
 *
 * Reusing the hub's helpers rather than filtering on `auth.orgId` matters twice
 * over. A Discord bot channel is usually tenant-scoped (`organization_id IS
 * NULL`), so an equality filter on the caller's selected organization would hide
 * exactly the channels this feature configures (#5012 fixed the same bug on the
 * hub's detail route). And a per-user channel belongs to its owner: the shared
 * access guards are what stop one operator from arming an AI on another's
 * mailbox, which no feature grant should be able to override.
 *
 * Returns `{ response }` with a masked 404 when the channel is absent or the
 * caller may not touch it — existence masking, consistent with the hub.
 */
export async function loadDiscordChannelForRequest(params: {
  container: AwilixContainer
  req: Request
  auth: RouteAuth
  channelId: string
  mode: 'read' | 'manage'
}): Promise<DiscordChannelAccess | { response: Response }> {
  const { container, req, auth, channelId, mode } = params
  const notFound = { response: NextResponse.json({ error: 'Channel not found' }, { status: 404 }) }

  const em = (container.resolve('em') as EntityManager).fork()
  const scope = await resolveOrganizationScopeForRequest({ container, auth: auth as never, request: req })
  const orgFilter = resolveOrganizationScopeFilter(scope, auth as never)

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: channelId,
      tenantId: auth.tenantId as string,
      providerKey: 'discord',
      ...channelOrgScopeWhereFromFilter(orgFilter),
      deletedAt: null,
    },
    undefined,
    { tenantId: auth.tenantId as string, organizationId: orgFilter.rbacOrganizationId },
  )
  if (!channel) return notFound

  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(auth.sub as string, {
      tenantId: auth.tenantId as string,
      organizationId: orgFilter.rbacOrganizationId,
    })
    userFeatures = acl.features
  } catch {
    // A failed ACL load leaves `userFeatures` empty, which only makes the guard
    // below stricter — it can deny, never grant.
    userFeatures = []
  }

  try {
    if (mode === 'manage') {
      assertCanManageChannel(channel, auth.sub ?? null, userFeatures, 'communication_channels.manage')
    } else {
      assertCanAccessChannel(channel, auth.sub ?? null, userFeatures)
    }
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) return notFound
    throw err
  }

  return {
    channel,
    organizationIds: orgFilter.organizationIds ?? null,
    rbacOrganizationId: orgFilter.rbacOrganizationId,
  }
}
