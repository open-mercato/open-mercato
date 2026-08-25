import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  CHANNEL_VISIBILITY_VALUES,
  COMMUNICATION_CHANNELS_SET_VISIBILITY_COMMAND_ID,
  type SetChannelVisibilityInput,
  type SetChannelVisibilityResult,
} from '../../../../../commands/set-channel-visibility'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/channels/[id]/visibility',
  PUT: {
    // Owner self-service, exactly like set-primary: the command enforces strict
    // ownership (`not_owner` → 404), so the dedicated share feature is the right
    // gate. `communication_channels.admin` stays inert — there is deliberately no
    // admin path to share someone else's mailbox.
    requireAuth: true,
    requireFeatures: ['communication_channels.share_own_channel'],
  },
}

const bodySchema = z.object({ visibility: z.enum(CHANNEL_VISIBILITY_VALUES) }).strict()

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // An API-key principal owns no mailbox, so it has nothing to share.
  if ((auth as { isApiKey?: boolean }).isApiKey) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await readJsonSafe(req, null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: id,
      operation: 'update',
      mutationPayload: { visibility: body.visibility },
    },
  })
  if ('response' in guard) return guard.response

  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const commandBus = container.resolve('commandBus') as CommandBus

  const input: SetChannelVisibilityInput = {
    channelId: id,
    userId: auth.sub as string,
    visibility: body.visibility,
    // Absent header ⇒ no expectation; the shared assertion helper skips the check
    // rather than blocking clients that never send it.
    expectedUpdatedAt: readOptimisticLockExpected(req),
    scope: { tenantId: auth.tenantId as string, organizationId },
  }

  let result: SetChannelVisibilityResult
  try {
    const executed = await commandBus.execute<
      SetChannelVisibilityInput,
      SetChannelVisibilityResult
    >(COMMUNICATION_CHANNELS_SET_VISIBILITY_COMMAND_ID, {
      input,
      ctx: {
        container,
        auth: auth as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    })
    result = executed.result
  } catch (err) {
    // Surfaces the 409 optimistic-lock conflict with its intended status rather
    // than a generic 500.
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  // Non-ownership maps to 404 (existence masking), consistent with every other
  // channel-scoped route.
  if (result.status === 'not_owner') {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  if (result.status === 'noop') {
    return NextResponse.json(
      { channelId: id, visibility: body.visibility, unchanged: true },
      { status: 200 },
    )
  }

  await guard.afterSuccess()
  return NextResponse.json(
    {
      channelId: result.channelId,
      visibility: body.visibility,
      previousVisibility: result.previousVisibility,
    },
    { status: 200 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    PUT: {
      summary: 'Mark your own personal channel as a shared team mailbox (or private again)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Visibility updated (or already at that value)' },
        { status: 400, description: 'Invalid channel id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Channel not found or not owned by current user' },
        { status: 409, description: 'Optimistic lock conflict' },
        { status: 422, description: 'Invalid body' },
      ],
    },
  },
}

export default PUT
