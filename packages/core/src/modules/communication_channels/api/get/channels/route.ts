import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../data/entities'
import { buildPerUserChannelFilter } from '../../../lib/access-control'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export const metadata = {
  path: '/communication_channels/channels',
  GET: { requireAuth: true, requireFeatures: ['communication_channels.view'] },
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  providerKey: z.string().optional(),
  channelType: z.string().optional(),
  isActive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
})

export async function GET(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { page, pageSize, providerKey, channelType, isActive } = parsed.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  // Per-user channel access control (spec § Hub Deltas → Delta 8):
  // callers without `communication_channels.admin` see only tenant-wide channels
  // and their own per-user channels. Resolving the user's ACL here keeps the
  // RBAC contract on the server side; the middleware can't apply it because
  // the filter is data-shaped (depends on the row's `user_id`).
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
  const perUserFilter = buildPerUserChannelFilter(auth.sub as string, userFeatures)

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    deletedAt: null,
    ...(perUserFilter ?? {}),
  }
  if (providerKey) where.providerKey = providerKey
  if (channelType) where.channelType = channelType
  if (isActive !== undefined) where.isActive = isActive

  const [items, total] = await findAndCountWithDecryption(
    em,
    CommunicationChannel,
    where as any,
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' } as any,
    },
    { tenantId: auth.tenantId as string, organizationId: (auth as { orgId?: string | null }).orgId ?? null },
  )

  return NextResponse.json({
    items: items.map(serializeChannel),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}

function serializeChannel(channel: CommunicationChannel) {
  return {
    id: channel.id,
    providerKey: channel.providerKey,
    channelType: channel.channelType,
    displayName: channel.displayName,
    externalIdentifier: channel.externalIdentifier ?? null,
    isActive: channel.isActive,
    capabilities: channel.capabilities ?? null,
    createdAt: channel.createdAt?.toISOString?.() ?? null,
    updatedAt: channel.updatedAt?.toISOString?.() ?? null,
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'List communication channels for the current tenant',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Channel list (paginated)' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
export default GET
