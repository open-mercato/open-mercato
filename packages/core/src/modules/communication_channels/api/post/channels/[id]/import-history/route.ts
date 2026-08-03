import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { CommunicationChannel } from '../../../../../data/entities'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../../../lib/access-control'
import {
  queueImportHistory,
  queueImportHistorySchema,
} from '../../../../../commands/queue-import-history'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'import-history' })

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

/**
 * Spec B § Phase B6 — operator-triggered backlog import.
 *
 * Enqueues a `channel-import-history` job that calls
 * `adapter.importHistory(...)` paginated up to `maxMessages`, routes each
 * message through `ingest-inbound-message`, and reports progress on a
 * `ProgressJob` consumed by the existing ProgressTopBar.
 *
 * Owner self-service: a user may import history for their OWN mailbox (gated by
 * `connect_user_channel`). Importing into a shared/tenant-wide channel still
 * requires `communication_channels.channel.import_history` — enforced per
 * channel type by `assertCanManageChannel` in the handler.
 */
export const metadata = {
  path: '/communication_channels/channels/[id]/import-history',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const bodySchema = queueImportHistorySchema.omit({ channelId: true })

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body defensively — the route is called from a CrudForm dialog, but
  // also from automated tests / scripts.
  let rawBody: unknown
  try {
    const text = await req.text()
    rawBody = text ? JSON.parse(text) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: first?.message ?? 'Invalid request',
        fieldErrors: first ? { [first.path.join('.')]: first.message } : undefined,
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization scope' }, { status: 400 })
  }
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  // Per-user access guard — load the channel just to check ownership; the
  // command repeats the lookup but at the cost of one extra read we get a
  // clean 404 for non-owners (instead of a generic 500 from inside the cmd).
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
      'communication_channels.channel.import_history',
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
      mutationPayload: parsed.data as unknown as Record<string, unknown>,
    },
  })
  if ('response' in guard) return guard.response

  try {
    const result = await queueImportHistory({
      container,
      scope: {
        tenantId: auth.tenantId as string,
        organizationId,
        userId: auth.sub as string,
      },
      input: { channelId: id, ...parsed.data },
    })
    await guard.afterSuccess()
    // 202 Accepted: durable work runs in the channel-import-history worker; the
    // response carries progressJobId for the ProgressTopBar (progress module contract).
    return NextResponse.json({ ok: true, ...result }, { status: 202 })
  } catch (err) {
    const candidate = err as CrudFormError
    if (candidate && typeof candidate.status === 'number') {
      return NextResponse.json(
        {
          error: candidate.message,
          fieldErrors: candidate.fieldErrors,
        },
        { status: candidate.status },
      )
    }
    logger.error('failed to enqueue for channel', { channelId: id, err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to queue import-history' },
      { status: 500 },
    )
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Queue a backlog import for a channel (Spec B § Phase B6)',
      tags: ['CommunicationChannels'],
      requestBody: {
        required: true,
        contentType: 'application/json',
        schema: bodySchema,
      },
      responses: [
        { status: 202, description: 'Import job queued; returns { progressJobId }' },
        { status: 400, description: 'Invalid channel id or unsupported provider' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found / not accessible' },
        { status: 409, description: 'Channel is not connected (requires reauth / error)' },
        {
          status: 429,
          description: 'Another import is already running for this channel',
        },
      ],
    },
  },
}

export default POST
