import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { renderMarkdownEmailBody } from './markdownEmailBody'

/**
 * Routing a compose through an employee's own connected mailbox (#6258).
 *
 * `communication_channels` owns every row inbound threading matches on
 * (`ExternalConversation`, `ChannelThreadMapping`, the outbound
 * `MessageChannelLink`), and its `sendAsUser` facade writes all of them around
 * the same `messages.messages.compose` command this route would call directly.
 * So the mailbox path delegates rather than reproducing those writes.
 *
 * The dependency is soft in the sanctioned direction: `messages` is the optional
 * consumer and owns the glue, `communication_channels` knows nothing about the
 * composer.
 */

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export type ComposeSenderActor = {
  userId: string
  tenantId: string
  organizationId: string | null
  auth?: unknown
}

export type ComposeSenderResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; status: number; error: string; fieldErrors: Record<string, string> }

type SendAsUserResult =
  | { ok: true; messageId: string; threadId: string; channelId: string; providerKey: string }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string> }

type SendAsUserService = (
  container: ContainerLike,
  actor: { userId: string; tenantId: string; organizationId: string | null; auth?: unknown },
  input: {
    userChannelId: string
    to: string[]
    subject: string
    body: { plain?: string; html?: string; bodyFormat?: 'text' | 'markdown' }
    parentMessageId?: string
    channelMetadata?: Record<string, unknown>
  },
) => Promise<SendAsUserResult>

/** The composer field the selector renders, so a failure lands on that control. */
export const COMPOSE_SENDER_FIELD = 'senderChannelId'

export function tryResolveSendAsUserService(
  container: ContainerLike,
): SendAsUserService | undefined {
  try {
    return container.resolve<SendAsUserService>('communicationChannelsSendAsUser')
  } catch {
    return undefined
  }
}

export type ComposeSenderRequest = {
  senderChannelId?: string
  visibility?: string | null
  externalEmail?: string
  subject?: string
  body?: string
  bodyFormat?: string
  isDraft?: boolean
  parentMessageId?: string
  attachmentIds?: string[]
  objects?: unknown[]
}

/** Whether this compose asked to be routed through one of the caller's mailboxes. */
export function requiresSenderDelegation(input: ComposeSenderRequest): boolean {
  return Boolean(input.senderChannelId) && input.isDraft !== true
}

/**
 * Compose the hub payload's body.
 *
 * A markdown compose is rendered to HTML with the same renderer the platform
 * email path uses, and the markdown source rides along as the plain-text
 * alternative. Passing markdown through as `plain` alone would deliver the raw
 * markup — asterisks and pipes — to the client. `bodyFormat` rides along
 * unchanged so the hub persists the in-app copy with the same format the
 * platform path would have used, instead of always storing it as `'text'`
 * (which would render the raw markdown source in the sender's own Sent view).
 */
export async function buildSenderBody(
  body: string,
  bodyFormat: string | undefined,
): Promise<{ plain?: string; html?: string; bodyFormat?: 'text' | 'markdown' }> {
  const format = bodyFormat === 'markdown' ? 'markdown' as const : 'text' as const
  if (format !== 'markdown' || !body.trim()) return { plain: body, bodyFormat: format }
  return { plain: body, html: await renderMarkdownEmailBody(body), bodyFormat: format }
}

/**
 * Send through the caller's mailbox, or explain why it cannot be done.
 *
 * Every failure carries a field error on the selector rather than a bare
 * message, so the composer renders it next to the control the user chose.
 */
export async function delegateComposeToSender(
  container: ContainerLike,
  actor: ComposeSenderActor,
  input: ComposeSenderRequest,
): Promise<ComposeSenderResult> {
  const senderChannelId = input.senderChannelId as string
  const { t } = await resolveTranslations()
  const fail = (status: number, error: string): ComposeSenderResult => ({
    ok: false,
    status,
    error,
    fieldErrors: { [COMPOSE_SENDER_FIELD]: error },
  })

  if (input.visibility !== 'public' || !input.externalEmail) {
    return fail(
      422,
      t(
        'messages.errors.senderRequiresExternalRecipient',
        'A sender mailbox can only be used for a message addressed to an external recipient.',
      ),
    )
  }
  // `SendAsUserInput` carries recipients, subject, body and threading headers
  // and nothing else. Refusing is the only honest answer while that is true —
  // accepting would drop the payload after the message had already been sent.
  if ((input.attachmentIds?.length ?? 0) > 0 || (input.objects?.length ?? 0) > 0) {
    return fail(
      422,
      t(
        'messages.errors.senderPayloadUnsupported',
        'Sending from your own mailbox does not support attachments or linked records yet.',
      ),
    )
  }

  const sendAsUser = tryResolveSendAsUserService(container)
  if (!sendAsUser) {
    return fail(
      422,
      t('messages.errors.senderUnavailable', 'Sending from your own mailbox is not available.'),
    )
  }

  const result = await sendAsUser(
    container,
    {
      userId: actor.userId,
      tenantId: actor.tenantId,
      organizationId: actor.organizationId,
      auth: actor.auth,
    },
    {
      userChannelId: senderChannelId,
      to: [input.externalEmail],
      subject: input.subject ?? '',
      body: await buildSenderBody(input.body ?? '', input.bodyFormat),
      parentMessageId: input.parentMessageId,
    },
  )

  if (result.ok) {
    return { ok: true, messageId: result.messageId, threadId: result.threadId }
  }

  const fieldMessage = Object.values(result.fieldErrors ?? {})[0] ?? result.error
  return {
    ok: false,
    status: result.status,
    error: result.error,
    fieldErrors: { [COMPOSE_SENDER_FIELD]: fieldMessage },
  }
}
