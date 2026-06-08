import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
  type ReassignConversationInput,
  type ReassignConversationResult,
} from '../../../../../commands/reassign-conversation'
import { validateRouteMutationGuard } from '../../../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/threads/[threadId]/assign',
  PUT: {
    requireAuth: true,
    requireFeatures: ['communication_channels.assign'],
  },
}

const bodySchema = z.object({
  assignedUserId: z.string().uuid().nullable(),
})

type RouteContext = {
  params: Promise<{ threadId: string }> | { threadId: string }
}

export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const { threadId } = await context.params
  if (!z.string().uuid().safeParse(threadId).success) {
    return NextResponse.json({ error: 'Invalid threadId' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const json = await readJsonSafe(req, null)
    body = bodySchema.parse(json)
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
      resourceKind: 'communication_channels.thread',
      resourceId: threadId,
      operation: 'custom',
      mutationPayload: body,
    },
  })
  if ('response' in guard) return guard.response

  const commandBus = container.resolve('commandBus') as CommandBus

  const input: ReassignConversationInput = {
    threadId,
    assignedUserId: body.assignedUserId,
    scope: {
      tenantId: auth.tenantId,
      organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    },
  }
  const { result } = await commandBus.execute<
    ReassignConversationInput,
    ReassignConversationResult
  >(COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID, {
    input,
    ctx: {
      container,
      auth: auth as never,
      organizationScope: null,
      selectedOrganizationId: (auth as { orgId?: string | null }).orgId ?? null,
      organizationIds: (auth as { orgId?: string | null }).orgId
        ? [(auth as { orgId?: string | null }).orgId!]
        : null,
    },
  })

  if (result.status === 'no_channel_link') {
    return NextResponse.json({ error: result.reason }, { status: 404 })
  }
  if (result.status === 'invalid_assignee') {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }
  if (result.status === 'noop') {
    return NextResponse.json(
      { threadId, assignedUserId: body.assignedUserId, unchanged: true },
      { status: 200 },
    )
  }
  await guard.afterSuccess()
  return NextResponse.json(
    {
      threadId: result.threadId,
      conversationId: result.conversationId,
      previousAssignedUserId: result.previousAssignedUserId,
      assignedUserId: result.nextAssignedUserId,
    },
    { status: 200 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    PUT: {
      summary: 'Reassign a channel-linked conversation to a different owner',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Conversation reassigned (or unchanged)' },
        { status: 400, description: 'Invalid threadId' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Conversation not channel-linked' },
        { status: 422, description: 'Invalid request body' },
      ],
    },
  },
}
export default PUT
