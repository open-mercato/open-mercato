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
  | { ok: false; status: number; error: string; fieldErrors: Record<string, string>; headers?: Record<string, string> }

type SendAsUserFailure = {
  ok: false
  status: number
  error: string
  fieldErrors?: Record<string, string>
  /** `already_linked`, `channel_unavailable`, or an attachment refusal such as `attachments_unsupported`. */
  code?: string
  headers?: Record<string, string>
}

type SendAsUserResult =
  | { ok: true; messageId: string; threadId: string; channelId: string; providerKey: string }
  | SendAsUserFailure

type SendAsUserActor = { userId: string; tenantId: string; organizationId: string | null; auth?: unknown }

type SendAsUserService = (
  container: ContainerLike,
  actor: SendAsUserActor,
  input:
    | {
        userChannelId: string
        to: string[]
        subject: string
        body: { plain?: string; html?: string; bodyFormat?: 'text' | 'markdown' }
        parentMessageId?: string
        channelMetadata?: Record<string, unknown>
        sendSeparately?: boolean
      }
    | { userChannelId: string; messageId: string },
) => Promise<SendAsUserResult>

type ValidateSenderChannelService = (
  container: ContainerLike,
  actor: SendAsUserActor,
  channelId: string,
) => Promise<{ ok: true; supportsAttachments?: boolean } | SendAsUserFailure>

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

function tryResolveValidateSenderChannelService(
  container: ContainerLike,
): ValidateSenderChannelService | undefined {
  try {
    return container.resolve<ValidateSenderChannelService>('communicationChannelsValidateSenderChannel')
  } catch {
    return undefined
  }
}

export type ComposeSenderRequest = {
  senderChannelId?: string
  scheduledAt?: Date | null
  visibility?: string | null
  externalEmail?: string
  externalEmails?: string[]
  sendSeparately?: boolean
  subject?: string
  body?: string
  bodyFormat?: string
  isDraft?: boolean
  parentMessageId?: string
  attachmentIds?: string[]
  attachmentRecordId?: string
  objects?: unknown[]
}

export function hasSenderAttachments(input: ComposeSenderRequest): boolean {
  return (input.attachmentIds?.length ?? 0) > 0 || Boolean(input.attachmentRecordId)
}

/** Whether this compose asked to be routed through one of the caller's mailboxes now (a scheduled one is handed off at release). */
export function requiresSenderDelegation(input: ComposeSenderRequest): boolean {
  return Boolean(input.senderChannelId) && input.isDraft !== true && !input.scheduledAt
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

function senderFailure(status: number, error: string, fieldMessage?: string): Extract<ComposeSenderResult, { ok: false }> {
  return { ok: false, status, error, fieldErrors: { [COMPOSE_SENDER_FIELD]: fieldMessage ?? error } }
}

async function refuseSenderRequest(input: ComposeSenderRequest): Promise<Extract<ComposeSenderResult, { ok: false }> | null> {
  const { t } = await resolveTranslations()
  const toAddresses = input.externalEmails ?? (input.externalEmail ? [input.externalEmail] : [])
  if (input.visibility !== 'public' || toAddresses.length === 0) {
    return senderFailure(
      422,
      t(
        'messages.errors.senderRequiresExternalRecipient',
        'A sender mailbox can only be used for a message addressed to an external recipient.',
      ),
    )
  }
  // Linked records have no mailbox representation yet (#6261); refusing beats
  // dropping them after the message was sent. Attachments are checked against
  // the mailbox's capabilities instead.
  if ((input.objects?.length ?? 0) > 0) {
    return senderFailure(
      422,
      t(
        'messages.errors.senderPayloadUnsupported',
        'Sending from your own mailbox does not support linked records yet.',
      ),
    )
  }
  return null
}

async function senderUnavailable(): Promise<Extract<ComposeSenderResult, { ok: false }>> {
  const { t } = await resolveTranslations()
  return senderFailure(422, t('messages.errors.senderUnavailable', 'Sending from your own mailbox is not available.'))
}

/**
 * Checks a stored message's mailbox up front (ownership, channel connected,
 * payload the mailbox can carry): a scheduled message is handed off only at
 * release, a sent draft only after it was flipped to sent.
 */
export async function validateMessageSender(
  container: ContainerLike,
  actor: ComposeSenderActor,
  input: ComposeSenderRequest,
): Promise<{ ok: true } | Extract<ComposeSenderResult, { ok: false }>> {
  const refusal = await refuseSenderRequest(input)
  if (refusal) return refusal
  const validate = tryResolveValidateSenderChannelService(container)
  if (!validate) return senderUnavailable()
  const result = await validate(
    container,
    { userId: actor.userId, tenantId: actor.tenantId, organizationId: actor.organizationId },
    input.senderChannelId as string,
  )
  if (!result.ok) return senderFailure(result.status, result.error, Object.values(result.fieldErrors ?? {})[0])
  if (hasSenderAttachments(input) && result.supportsAttachments !== true) return senderAttachmentsUnsupported()
  return { ok: true }
}

async function senderAttachmentsUnsupported(): Promise<Extract<ComposeSenderResult, { ok: false }>> {
  const { t } = await resolveTranslations()
  return senderFailure(
    422,
    t(
      'messages.errors.senderAttachmentsUnsupported',
      'The selected mailbox cannot send attachments. Remove the attachments or choose another sender.',
    ),
  )
}

export type MessageHandOffResult =
  | { ok: true }
  | { ok: false; status: number; error: string; fieldErrors: Record<string, string>; code?: string }

/**
 * Deliver an existing, already sent message through the author's mailbox
 * (`sendAsUser` existing-message mode). The `communication_channels` module
 * being absent reads as an unavailable channel.
 */
export async function handOffMessageToSender(
  container: ContainerLike,
  actor: ComposeSenderActor,
  target: { senderChannelId: string; messageId: string },
): Promise<MessageHandOffResult> {
  const sendAsUser = tryResolveSendAsUserService(container)
  if (!sendAsUser) return { ...(await senderUnavailable()), code: 'channel_unavailable' }
  const result = await sendAsUser(
    container,
    { userId: actor.userId, tenantId: actor.tenantId, organizationId: actor.organizationId, auth: actor.auth },
    { userChannelId: target.senderChannelId, messageId: target.messageId },
  )
  if (result.ok) return { ok: true }
  return {
    ...senderFailure(result.status, result.error, Object.values(result.fieldErrors ?? {})[0]),
    ...(result.code ? { code: result.code } : {}),
  }
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
  const refusal = await refuseSenderRequest(input)
  if (refusal) return refusal
  // Compose mode has no message to own the files yet; the compose route sends attachments as a draft through the mailbox instead.
  if (hasSenderAttachments(input)) return senderAttachmentsUnsupported()
  const toAddresses = input.externalEmails ?? (input.externalEmail ? [input.externalEmail] : [])

  const sendAsUser = tryResolveSendAsUserService(container)
  if (!sendAsUser) return senderUnavailable()

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
      to: toAddresses,
      sendSeparately: input.sendSeparately,
      subject: input.subject ?? '',
      body: await buildSenderBody(input.body ?? '', input.bodyFormat),
      parentMessageId: input.parentMessageId,
    },
  )

  if (result.ok) {
    return { ok: true, messageId: result.messageId, threadId: result.threadId }
  }

  return {
    ...senderFailure(result.status, result.error, Object.values(result.fieldErrors ?? {})[0]),
    ...(result.headers ? { headers: result.headers } : {}),
  }
}
