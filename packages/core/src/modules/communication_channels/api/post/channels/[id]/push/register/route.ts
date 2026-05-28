import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { pushRegister } from '../../../../../../commands/push-register'
import { validateRouteMutationGuard } from '../../../../../../lib/route-mutation-guard'

/**
 * Spec C § Phase C5 — Operator-facing "Re-register push" endpoint.
 *
 * Gated by `communication_channels.channel.push.manage` (admin / superadmin
 * by default). Used by the channel detail page's `PushStatusSection` to
 * recover from a `pushStatus='failed'` state after fixing a Pub/Sub topic
 * misconfiguration or after a Microsoft subscription is dropped.
 */
export const metadata = {
  path: '/communication_channels/channels/[id]/push/register',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.channel.push.manage'],
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
    console.error(`[push-register] failed for channel ${id}:`, err)
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
