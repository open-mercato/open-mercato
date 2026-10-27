import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../../../../../data/entities'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../../../lib/access-control'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../../../../../lib/queue'
import { isHubPolledChannel } from '../../../../../lib/polling-eligibility'
import type { PollChannelJobPayload } from '../../../../../workers/poll-channel'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export const metadata = {
  path: '/communication_channels/channels/[id]/poll-now',
  POST: {
    // Owner self-service: a user may sync their OWN mailbox (gated by
    // `connect_user_channel`). Polling a shared/tenant-wide channel still
    // requires `manage` — enforced per channel type by `assertCanManageChannel`.
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

/**
 * Manual poll trigger — enqueues a single `poll-channel` job immediately so
 * the operator (or a demo) doesn't have to wait for the 60-second scheduler
 * tick + per-channel `poll_interval_seconds` window.
 *
 * Per-user access guard mirrors the rest of the channels API: only the channel
 * owner (or an admin with `communication_channels.admin`) can trigger a poll.
 */
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

  // Load features via RBAC so admin bypass is honoured.
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

  if (!channel.isActive) {
    return NextResponse.json({ error: 'Channel is disabled' }, { status: 409 })
  }
  // Allow manual poll-now from 'connected' AND 'error' states. The operator's
  // intent in clicking "Poll now" while the channel is in error is exactly
  // "retry the connection right now"; a successful poll auto-resets status
  // back to 'connected' (see poll-channel.ts).
  // Block only the explicitly-broken lifecycle states.
  if (channel.status === 'requires_reauth') {
    return NextResponse.json(
      { error: 'Channel needs reauthentication — reconnect from /backend/profile/communication-channels' },
      { status: 409 },
    )
  }
  if (channel.status === 'disconnected') {
    return NextResponse.json(
      { error: 'Channel is disconnected — reconnect to resume polling' },
      { status: 409 },
    )
  }
  // The poll worker returns immediately for a channel whose adapter declares
  // real-time push, so enqueueing a job here would answer 202 for work that can
  // never run and the UI would promise messages that never arrive (#4980).
  if (!isHubPolledChannel(channel.capabilities)) {
    // The page flashes this string verbatim, so it is operator-facing. Localize
    // it when a request locale is resolvable and fall back to English rather
    // than failing the request if the i18n registry is uninitialized — the same
    // defensive shape the module's command interceptors use.
    const fallback =
      'Channel is push-driven — polling does not apply. Inbound messages arrive through the provider push connection.'
    let message = fallback
    try {
      const { translate } = await resolveTranslations()
      message = translate('communication_channels.errors.pollNowPushDriven', fallback)
    } catch {
      message = fallback
    }
    return NextResponse.json({ error: message }, { status: 409 })
  }

  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: channel.id,
      operation: 'custom',
      mutationPayload: { action: 'poll-now' },
    },
  })
  if ('response' in guard) return guard.response

  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)
  const payload: PollChannelJobPayload = {
    channelId: channel.id,
    scope: {
      tenantId: auth.tenantId as string,
      organizationId: organizationId ?? null,
    },
    attempt: 1,
  }
  await queue.enqueue(payload as unknown as Record<string, unknown>)
  await guard.afterSuccess()

  return NextResponse.json(
    {
      ok: true,
      channelId: channel.id,
      queued: true,
      message: 'Poll queued — new messages will appear after the worker runs.',
    },
    { status: 202 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Manually trigger a poll cycle for a channel (demo / operator override)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 202, description: 'Poll job enqueued' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found' },
        { status: 409, description: 'Channel disabled, not connected, or push-driven (never polled)' },
      ],
    },
  },
}
export default POST
