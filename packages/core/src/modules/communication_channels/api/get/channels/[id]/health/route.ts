import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sql } from 'kysely'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel, ExternalConversation, MessageChannelLink } from '../../../../../data/entities'
import {
  ChannelAccessDeniedError,
  assertCanAccessChannel,
  channelOrgScopeWhere,
} from '../../../../../lib/access-control'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export const metadata = {
  path: '/communication_channels/channels/[id]/health',
  GET: { requireAuth: true, requireFeatures: ['communication_channels.view'] },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const WINDOW_HOURS = 24
const RECENT_FAILURES_LIMIT = 10

/**
 * Channel health snapshot — live aggregates from `message_channel_links` rather
 * than a dedicated `HealthLog` table.
 *
 * Returns counts of `sent` / `failed` / `pending` deliveries in the trailing
 * 24-hour window, plus the most recent failed links with last-error context.
 *
 * Per-user isolation: aggregates are scoped to **this channel only** via the
 * `external_conversations.channelId` join (a MessageChannelLink does not have a
 * direct channelId column — the link goes through ExternalConversation). Before
 * any DB read for aggregates, the channel must pass `assertCanAccessChannel`
 * so a non-admin caller cannot inspect another user's channel telemetry.
 */
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

  const dscope = {
    tenantId: auth.tenantId as string,
    organizationId: (auth as { orgId?: string | null }).orgId ?? null,
  }
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id, tenantId: auth.tenantId, ...channelOrgScopeWhere(dscope.organizationId), deletedAt: null },
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
      organizationId: dscope.organizationId,
    })
    userFeatures = acl?.isSuperAdmin ? ['*'] : Array.isArray(acl?.features) ? acl.features : []
  } catch {
    userFeatures = []
  }
  try {
    assertCanAccessChannel(channel, auth.sub as string, userFeatures)
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    throw err
  }

  // ExternalConversation is append-only on the hub side — no soft-delete column.
  // Scope by channel + tenant so aggregates stay isolated even when the same
  // provider is connected by multiple users in the same tenant.
  const conversations = await findWithDecryption(
    em,
    ExternalConversation,
    { channelId: channel.id, tenantId: auth.tenantId },
    undefined,
    dscope,
  )
  const conversationIds = conversations.map((c) => c.id).filter(Boolean) as string[]

  const counts = { sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, queued: 0, other: 0 }
  let totalsLast24h = 0
  let recentFailures: MessageChannelLink[] = []
  if (conversationIds.length > 0) {
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)

    // Aggregate the delivery-status counts in the database so the response stays
    // a small fixed shape regardless of how much traffic the channel saw in the
    // window. `delivery_status`, `external_conversation_id`, `tenant_id` and
    // `created_at` are plaintext columns (see encryption.ts — only
    // `channel_ingest_dead_letter.raw_body` is encrypted on this module), so a
    // grouped count is safe without the decryption helpers.
    const db = em.getKysely<any>() as any
    const statusRows = (await db
      .selectFrom('message_channel_links')
      .select(['delivery_status', sql<string>`count(*)`.as('count')])
      .where('external_conversation_id', 'in', conversationIds)
      .where('tenant_id', '=', auth.tenantId)
      .where('created_at', '>=', since)
      .groupBy('delivery_status')
      .execute()) as Array<{ delivery_status: string | null; count: string | number }>

    for (const row of statusRows) {
      const value = Number(row.count) || 0
      totalsLast24h += value
      const key = row.delivery_status as keyof typeof counts
      if (key && key in counts) counts[key] += value
      else counts.other += value
    }

    recentFailures = await findWithDecryption(
      em,
      MessageChannelLink,
      {
        externalConversationId: { $in: conversationIds },
        tenantId: auth.tenantId,
        deliveryStatus: 'failed',
      },
      { limit: RECENT_FAILURES_LIMIT, orderBy: { createdAt: 'desc' } },
      dscope,
    )
  }

  return NextResponse.json({
    channelId: channel.id,
    providerKey: channel.providerKey,
    channelType: channel.channelType,
    windowHours: WINDOW_HOURS,
    counts,
    totalsLast24h,
    recentFailures: recentFailures.map((link) => ({
      id: link.id,
      messageId: link.messageId,
      direction: link.direction,
      createdAt: link.createdAt?.toISOString?.() ?? null,
      lastError:
        (link.channelMetadata as Record<string, unknown> | null)?.lastError ?? null,
      transient:
        (link.channelMetadata as Record<string, unknown> | null)?.transient ?? null,
    })),
  })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'Snapshot of channel delivery health (last 24h)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Health snapshot' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found' },
      ],
    },
  },
}
export default GET
