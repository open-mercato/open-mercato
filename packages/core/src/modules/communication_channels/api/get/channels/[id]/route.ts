import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../data/entities'
import { ChannelAccessDeniedError, assertCanAccessChannel } from '../../../../lib/access-control'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export const metadata = {
  path: '/communication_channels/channels/[id]',
  GET: { requireAuth: true, requireFeatures: ['communication_channels.view'] },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id,
      tenantId: auth.tenantId,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
      deletedAt: null,
    },
    undefined,
    { tenantId: auth.tenantId as string, organizationId: (auth as { orgId?: string | null }).orgId ?? null },
  )
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  // Per-user access guard: callers without `communication_channels.admin` can
  // only see tenant-wide channels (userId IS NULL) or channels they own.
  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(auth.sub as string, {
      tenantId: auth.tenantId as string,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    })
    userFeatures = acl?.isSuperAdmin
      ? ['*']
      : (Array.isArray(acl?.features) ? acl.features : [])
  } catch {
    userFeatures = []
  }
  try {
    assertCanAccessChannel(channel, auth.sub as string, userFeatures)
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) {
      // 404 (not 403) — don't leak existence of other users' channels.
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    throw err
  }

  return NextResponse.json({
    id: channel.id,
    providerKey: channel.providerKey,
    channelType: channel.channelType,
    displayName: channel.displayName,
    externalIdentifier: channel.externalIdentifier ?? null,
    credentialsRef: channel.credentialsRef ?? null,
    capabilities: channel.capabilities ?? null,
    isActive: channel.isActive,
    organizationId: channel.organizationId ?? null,
    createdAt: channel.createdAt?.toISOString?.() ?? null,
    updatedAt: channel.updatedAt?.toISOString?.() ?? null,
  })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'Get a single communication channel by id',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Channel detail' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found' },
      ],
    },
  },
}
export default GET
