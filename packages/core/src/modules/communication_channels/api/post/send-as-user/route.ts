import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findSendSeparatelyCopyFields, sendAsUser } from '../../../lib/send-as-user'
import { validateRouteMutationGuard } from '../../../lib/route-mutation-guard'
import { outboundAttachmentRefSchema } from '../../../lib/outbound-attachments'

export const metadata = {
  path: '/communication_channels/send-as-user',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.manage'],
  },
}

const SEND_SEPARATELY_WITH_COPIES = 'messages.errors.sendSeparatelyWithCopies'

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
   * not interpret them, except that it owns `outboundAttachments` and drops a
   * caller-supplied value.
   */
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
  /** One email per "to" address; with more than one "to" it cannot be combined with cc/bcc (400). */
  sendSeparately: z.boolean().optional(),
  /**
   * Files from the attachments module, by id and owning record. Sent only
   * through a channel whose adapter advertises `fileSharing`. The count is
   * checked by the facade so the refusal carries its `code`.
   */
  attachments: z.array(outboundAttachmentRefSchema).optional(),
}).superRefine((value, ctx) => {
  for (const field of findSendSeparatelyCopyFields(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: SEND_SEPARATELY_WITH_COPIES })
  }
})

/** Delivers an existing sent message of the caller through the channel instead of composing one. */
const existingMessageBodySchema = z.object({
  userChannelId: z.string().uuid(),
  messageId: z.string().uuid(),
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
})

/** Both request shapes the handler accepts, published as one OpenAPI request body. */
export const requestBodySchema = z.union([existingMessageBodySchema, bodySchema])

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

  let body: z.infer<typeof bodySchema> | z.infer<typeof existingMessageBodySchema>
  try {
    const raw = await readJsonSafe<Record<string, unknown> | null>(req, null)
    body = raw && raw.messageId !== undefined ? existingMessageBodySchema.parse(raw) : bodySchema.parse(raw)
  } catch (err) {
    const copyIssues = err instanceof z.ZodError
      ? err.issues.filter((issue) => issue.message === SEND_SEPARATELY_WITH_COPIES)
      : []
    if (copyIssues.length > 0) {
      const { t } = await resolveTranslations()
      const error = t(
        SEND_SEPARATELY_WITH_COPIES,
        'Send separately cannot be combined with CC or BCC when there is more than one recipient.',
      )
      return NextResponse.json(
        { error, fieldErrors: Object.fromEntries(copyIssues.map((issue) => [String(issue.path[0]), error])) },
        { status: 400 },
      )
    }
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
      {
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
      },
      { status: result.status, headers: result.headers },
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
      description:
        'Composes and sends a new message, or (with `messageId`) delivers an existing sent message of the caller through the channel.',
      requestBody: { required: true, contentType: 'application/json', schema: requestBodySchema },
      responses: [
        { status: 202, description: 'Message persisted; outbound delivery enqueued' },
        { status: 400, description: 'sendSeparately combined with cc/bcc for more than one recipient' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Cannot send through a channel you don\'t own' },
        { status: 404, description: 'Channel (or the given messageId) not found' },
        { status: 409, description: 'Channel in a non-deliverable transitional status, or messageId already linked / not sent yet' },
        {
          status: 422,
          description:
            'Invalid body, channel requires_reauth / disconnected, or attachments rejected (`code`: attachments_unsupported, too_many_attachments, duplicate_attachment, attachment_not_found, attachment_type_not_allowed, attachments_too_large)',
        },
      ],
    },
  },
}
export default POST
