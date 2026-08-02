import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { CommunicationChannel } from '../../../../../../data/entities'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../../../../lib/access-control'
import { pushRegister } from '../../../../../../commands/push-register'
import { validateRouteMutationGuard } from '../../../../../../lib/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'push-register' })

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

/**
 * Spec C § Phase C5 — Operator-facing "Re-register push" endpoint.
 *
 * Owner self-service: a user may (re-)register push on their OWN mailbox (gated
 * by `connect_user_channel`). Registering push on a shared/tenant-wide channel
 * still requires `communication_channels.channel.push.manage` — enforced per
 * channel type by `assertCanManageChannel` in the handler. Used by the profile
 * page and the channel detail page's `PushStatusSection` to recover from a
 * `pushStatus='failed'` state.
 */
export const metadata = {
  path: '/communication_channels/channels/[id]/push/register',
  POST: {
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
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization scope' }, { status: 400 })
  }

  const container = await createRequestContainer()

  // Defense-in-depth: `push.manage` is admin-default, but enforce per-user
  // ownership anyway so a non-admin operator who is granted `push.manage`
  // cannot re-register push on another user's channel. Admins (and tenant-wide
  // channels) pass via `assertCanAccessChannel`. Automatic callers (OAuth
  // callback, connect, renew worker) invoke `pushRegister` directly and are
  // intentionally not subject to this user-facing guard.
  const em = (container.resolve('em') as EntityManager).fork()
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id, tenantId: auth.tenantId as string, organizationId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId as string, organizationId },
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
      'communication_channels.channel.push.manage',
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
      operation: 'custom',
      mutationPayload: { pushStatus: 'register' },
    },
  })
  if ('response' in guard) return guard.response

  try {
    const result = await pushRegister({
      container,
      scope: { tenantId: auth.tenantId as string, organizationId, userId: auth.sub as string },
      input: { channelId: id },
    })
    await guard.afterSuccess()
    return NextResponse.json({ ok: true, ...result }, { status: 202 })
  } catch (err) {
    const candidate = err as CrudFormError
    if (candidate && typeof candidate.status === 'number') {
      return NextResponse.json(
        { error: candidate.message, fieldErrors: candidate.fieldErrors },
        { status: candidate.status },
      )
    }
    logger.error('push register failed for channel', { channelId: id, err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to register push' },
      { status: 500 },
    )
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Force-register push delivery for a channel (Spec C § Phase C5)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 202, description: 'Push registration attempted; check result.pushStatus' },
        { status: 400, description: 'Invalid id or unsupported provider' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing push.manage feature' },
        { status: 404, description: 'Channel not found' },
        { status: 409, description: 'Provider does not support push (IMAP)' },
        { status: 502, description: 'Provider returned an error during registration' },
        { status: 503, description: 'Webhook base URL or Pub/Sub topic not configured' },
      ],
    },
  },
}

export default POST
