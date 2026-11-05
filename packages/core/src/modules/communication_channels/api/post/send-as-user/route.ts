import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { sendAsUser } from '../../../lib/send-as-user'
import { validateRouteMutationGuard } from '../../../lib/route-mutation-guard'

export const metadata = {
  path: '/communication_channels/send-as-user',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.manage'],
  },
}

const bodySchema = z.object({
  /** ID of the user-owned channel to send from. Caller MUST own the channel. */
  userChannelId: z.string().uuid(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  // `.regex(/^[^\r\n]*$/)` rejects CR/LF so a caller cannot inject extra email
  // headers (e.g. a hidden Bcc) through the subject / threading fields. The
  // outbound MIME assembler also sanitizes these, but fail fast at the edge.
  subject: z.string().min(1).max(500).regex(/^[^\r\n]*$/),
  body: z.object({
    plain: z.string().max(50_000).optional(),
    html: z.string().max(200_000).optional(),
  }),
  inReplyTo: z.string().min(1).max(500).regex(/^[^\r\n]*$/).optional(),
  references: z.array(z.string().min(1).max(500).regex(/^[^\r\n]*$/)).optional(),
  /**
   * Free-form metadata persisted on the resulting MessageChannelLink. Used by
   * downstream subscribers (e.g. the customers module's link-channel-message
   * subscriber) to anchor the sent message back to a CRM Person or honor a
   * caller-specified visibility flag. Keys are caller-defined; the hub does
   * not interpret them.
   */
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Programmatic send-as-user facade (HTTP entry point).
 *
 * Thin wrapper around the in-process `sendAsUser` lib facade
 * (`../../../lib/send-as-user`), which is also resolvable via DI as
 * `communicationChannelsSendAsUser` for in-process cross-module callers.
 * Returns once the Message is persisted; the actual external send is async.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const guard = await validateRouteMutationGuard({
    container,
    req,
    auth,
    input: {
      resourceKind: 'communication_channels.channel',
      resourceId: body.userChannelId,
      operation: 'custom',
      mutationPayload: body as unknown as Record<string, unknown>,
    },
  })
  if ('response' in guard) return guard.response

  const result = await sendAsUser(
    container,
    { userId: auth.sub as string, tenantId: auth.tenantId as string, organizationId, auth },
    body,
  )

  if (!result.ok) {
    return NextResponse.json(
      result.fieldErrors ? { error: result.error, fieldErrors: result.fieldErrors } : { error: result.error },
      { status: result.status },
    )
  }
  await guard.afterSuccess()

  return NextResponse.json(
    {
      messageId: result.messageId,
      threadId: result.threadId,
      channelId: result.channelId,
      providerKey: result.providerKey,
      enqueuedForDelivery: true,
    },
    { status: 202 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Send a message through the current user\'s own channel',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 202, description: 'Message persisted; outbound delivery enqueued' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Cannot send through a channel you don\'t own' },
        { status: 404, description: 'Channel not found' },
        { status: 409, description: 'Channel in a non-deliverable transitional status' },
        { status: 422, description: 'Invalid body, or channel requires_reauth / disconnected' },
      ],
    },
  },
}
export default POST
