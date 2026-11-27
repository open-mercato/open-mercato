import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Message, MessageExternalParticipant } from '../../messages/data/entities'
import { SEND_AS_USER_SOURCE_ENTITY_TYPE } from '../../messages/lib/messageSourceEntityTypes'
import { renderMarkdownEmailBody } from '../../messages/lib/markdownEmailBody'
import { isSchedulingAvailableFor } from '../../messages/lib/scheduledSend'
import { getMessageAttachments } from '../../messages/lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../../messages/lib/constants'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../data/entities'
import { ChannelMutationBlockedError, guardOutboundCreate } from './mutation-guards'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from './queue'
import type { OutboundDeliveryPayload } from '../workers/outbound-delivery'
import { htmlToText } from './email-mime'
import type { ChannelAdapterRegistry } from './registry'
import {
  OUTBOUND_ATTACHMENTS_METADATA_KEY,
  omitOutboundAttachments,
  parseOutboundAttachmentRefs,
  readStoredOutboundAttachments,
  validateOutboundAttachments,
  type OutboundAttachmentErrorCode,
  type OutboundAttachmentRef,
  type StoredOutboundAttachment,
} from './outbound-attachments'
import { buildOutboundConversationRef } from './outbound-conversation-ref'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const logger = createLogger('communication_channels')

export type SendAsUserActor = {
  userId: string
  tenantId: string
  organizationId: string | null
  /** Forwarded as the messages compose command `ctx.auth`. */
  auth?: unknown
}

export type SendAsUserInput = {
  userChannelId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: { plain?: string; html?: string; bodyFormat?: 'text' | 'markdown' }
  inReplyTo?: string
  references?: string[]
  /**
   * Open Mercato `messages.message` id of the message being replied to. When
   * set, the composed message joins that message's thread (the messages module
   * derives `threadId` from the parent), so a CRM reply continues the existing
   * conversation instead of starting a new thread. Optional — omitted for new
   * threads.
   *
   * Not authorized here: the facade serves more than one surface, and each owns
   * what "may reply to" means. The caller MUST have established that the actor
   * can read this message under its own read rule before passing it.
   */
  parentMessageId?: string
  /**
   * Free-form metadata persisted on the resulting MessageChannelLink. Used by
   * downstream subscribers (e.g. the customers module's link-channel-message
   * subscriber) to anchor the sent message back to a CRM Person or honor a
   * caller-specified visibility flag. The hub does not interpret these keys,
   * except that it owns `outboundAttachments` and drops a caller-supplied value.
   */
  channelMetadata?: Record<string, unknown>
  /**
   * Deliver one email per "to" address so recipients do not see each other.
   * Cannot be combined with cc/bcc when there is more than one "to" address.
   */
  sendSeparately?: boolean
  /**
   * Send later: the message is stored as scheduled (no channel link, nothing
   * enqueued) and the messages release tick hands it to `userChannelId` at this
   * instant, replaying `channelMetadata`, `inReplyTo`, `references` and the
   * validated `attachments`.
   */
  scheduledAt?: Date
  /**
   * Files from the attachments module to send with the message. Each ref names
   * the record that owns the file; like `parentMessageId`, the caller MUST have
   * established that the actor can read that record. The hub checks the rest:
   * the adapter ships files (`fileSharing`), the file is readable in the
   * actor's tenant and organization and owned by `owner`, its type and size fit
   * the adapter. Only the refs are stored; the bytes are read at delivery.
   * With "send separately" every copy carries the same files.
   */
  attachments?: OutboundAttachmentRef[]
}

/**
 * Delivers an existing, already sent `messages.message` through the actor's
 * mailbox (scheduled release, sending a saved draft) instead of composing a new
 * one. Recipients, subject, body and "send separately" come from the message.
 * Without `channelMetadata`, the message's stored `senderDeliveryOptions`
 * (written by a scheduled compose) supply the metadata and threading headers.
 */
export type SendAsUserExistingMessageInput = {
  userChannelId: string
  messageId: string
  channelMetadata?: Record<string, unknown>
  /** The scheduled release claim (`scheduledReleaseAttempts`) the caller holds; the hand-off is refused once another claim took over. */
  expectedReleaseAttempts?: number
}

/**
 * `already_linked`: the message already has an outbound link (a previous attempt
 * handed it off). `channel_unavailable`: the channel is missing, not the actor's,
 * or cannot deliver (`requires_reauth`, `disconnected`, not connected).
 * `scheduling_unavailable`: `scheduledAt` was set but the scheduler module is absent.
 * `release_superseded`: the scheduled release claim passed as `expectedReleaseAttempts` is no longer current.
 */
export type SendAsUserFailureCode = 'already_linked' | 'channel_unavailable' | 'scheduling_unavailable' | 'release_superseded'

export type SendAsUserResult =
  | {
      ok: true
      messageId: string
      threadId: string
      channelId: string
      providerKey: string
      /** ISO instant the message is scheduled for; set only by a scheduled compose. */
      scheduledAt?: string
    }
  | {
      ok: false
      status: number
      error: string
      fieldErrors?: Record<string, string>
      code?: SendAsUserFailureCode | OutboundAttachmentErrorCode
      headers?: Record<string, string>
    }

type SendAsUserFailure = Extract<SendAsUserResult, { ok: false }>

/**
 * In-process send-as-user facade.
 *
 * With `messageId` it delivers that existing message instead of composing one
 * (see `SendAsUserExistingMessageInput`). Otherwise it validates the actor
 * owns `userChannelId`, composes the Message via the messages module command,
 * persists the outbound MessageChannelLink + thread
 * mapping, and enqueues delivery. Returns a discriminated result instead of an
 * HTTP Response so it can be invoked both by the `/send-as-user` route and by
 * other modules via DI (`container.resolve('communicationChannelsSendAsUser')`)
 * — no HTTP self-call required.
 */
export async function sendAsUser(
  container: AppContainer,
  actor: SendAsUserActor,
  input: SendAsUserInput | SendAsUserExistingMessageInput,
): Promise<SendAsUserResult> {
  if ('messageId' in input) return sendExistingMessageAsUser(container, actor, input)
  if (!input.body.plain && !input.body.html) {
    return { ok: false, status: 422, error: 'Either body.plain or body.html is required' }
  }
  // Re-validate here (not only in the HTTP route's zod schema) because this
  // facade is also reachable via DI; `input.to[0]` below would otherwise become
  // `undefined` for an empty recipient list.
  if (!Array.isArray(input.to) || input.to.length === 0) {
    return { ok: false, status: 422, error: 'At least one recipient is required' }
  }
  const copiesError = await validateSendSeparately(input)
  if (copiesError) return copiesError
  const sendSeparately = input.sendSeparately === true && input.to.length > 1
  const scheduledAt = input.scheduledAt ?? null
  if (scheduledAt && !isSchedulingAvailableFor(container, actor.organizationId)) {
    const { t } = await resolveTranslations()
    const error = t('messages.errors.schedulingUnavailable', 'Scheduled sending is not available.')
    return { ok: false, status: 422, error, fieldErrors: { scheduledAt: error }, code: 'scheduling_unavailable' }
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const { tenantId } = actor
  const organizationId = actor.organizationId
  const dscope = { tenantId, organizationId }

  const resolved = await resolveSendableChannel(em, actor, input.userChannelId)
  if (!resolved.ok) return resolved
  const { channel } = resolved

  // Re-parsed for the same reason as `to`: DI callers skip the route's schema.
  const attachmentRefs = input.attachments === undefined ? [] : parseOutboundAttachmentRefs(input.attachments)
  if (!attachmentRefs) {
    return { ok: false, status: 422, error: '[internal] attachments must be attachment references' }
  }

  let storedAttachments: StoredOutboundAttachment[] = []
  if (attachmentRefs.length) {
    const adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
    const adapter = adapterRegistry.get(channel.providerKey)
    if (!adapter) return { ok: false, status: 409, error: '[internal] No channel adapter registered for this provider' }
    const validation = await validateOutboundAttachments({
      container,
      scope: { userId: actor.userId, tenantId, organizationId },
      refs: attachmentRefs,
      capabilities: adapter.capabilities,
    })
    if (!validation.ok) {
      return { ok: false, status: validation.status, error: validation.error, code: validation.code }
    }
    storedAttachments = validation.stored
  }

  // Create the Message via the messages module compose command. The outbound
  // subscriber picks it up via `messages.message.sent` and routes through the
  // adapter chain.
  const commandBus = container.resolve('commandBus') as CommandBus
  const messageBody = input.body.plain ?? htmlToText(input.body.html ?? '')
  const composeInput = {
    type: `channel.${channel.providerKey}`,
    visibility: 'public' as const,
    sourceEntityType: SEND_AS_USER_SOURCE_ENTITY_TYPE,
    sourceEntityId: channel.id,
    externalEmail: input.to[0],
    // Every addressee becomes a participant: they are what delivery addresses.
    externalParticipants: [
      ...input.to.map((email) => ({ email, role: 'to' as const })),
      ...(input.cc ?? []).map((email) => ({ email, role: 'cc' as const })),
      ...(input.bcc ?? []).map((email) => ({ email, role: 'bcc' as const })),
    ],
    sendSeparately,
    ...(channel.channelType === 'email'
      ? { externalEmailRecipients: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])] }
      : {}),
    externalName: input.subject,
    recipients: [],
    subject: input.subject,
    body: messageBody,
    bodyFormat: input.body.bodyFormat === 'markdown' ? ('markdown' as const) : ('text' as const),
    priority: 'normal' as const,
    sendViaEmail: false,
    parentMessageId: input.parentMessageId,
    isDraft: false,
    ...(scheduledAt
      ? {
          scheduledAt,
          senderChannelId: channel.id,
          senderDeliveryOptions: {
            ...(input.channelMetadata || storedAttachments.length
              ? {
                  channelMetadata: {
                    ...omitOutboundAttachments(input.channelMetadata),
                    ...(storedAttachments.length ? { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: storedAttachments } : {}),
                  },
                }
              : {}),
            inReplyTo: input.inReplyTo ?? null,
            references: input.references ?? [],
          },
        }
      : {}),
    tenantId,
    organizationId,
    userId: actor.userId,
  }
  let result
  try {
    result = await commandBus.execute<typeof composeInput, { id: string; threadId: string | null }>(
      'messages.messages.compose',
      {
        input: composeInput,
        ctx: {
          container,
          auth: actor.auth as never,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: organizationId ? [organizationId] : null,
        },
      },
    )
  } catch (err) {
    const scheduleIssue = err instanceof z.ZodError
      ? err.issues.find((issue) => issue.path[0] === 'scheduledAt')
      : undefined
    if (scheduleIssue) {
      const { t } = await resolveTranslations()
      const error = t(scheduleIssue.message, scheduleIssue.message)
      return { ok: false, status: 400, error, fieldErrors: { scheduledAt: error } }
    }
    if (isCrudHttpError(err)) {
      return {
        ok: false,
        status: err.status,
        error: typeof err.body.error === 'string' ? err.body.error : err.message,
        ...('headers' in err && err.headers instanceof Headers
          ? { headers: Object.fromEntries(err.headers.entries()) }
          : {}),
      }
    }
    logger.error('communication_channels send-as-user compose failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'communication_channels', code: 'communication_channels.compose_failed' })
    return { ok: false, status: 500, error: '[internal] compose failed' }
  }

  const messageId = result.result.id
  const messageThreadId = result.result.threadId ?? messageId
  if (scheduledAt) {
    return {
      ok: true,
      messageId,
      threadId: messageThreadId,
      channelId: channel.id,
      providerKey: channel.providerKey,
      scheduledAt: scheduledAt.toISOString(),
    }
  }
  const separateParticipants = sendSeparately
    ? await findWithDecryption(
        em,
        MessageExternalParticipant,
        { messageId, role: 'to', tenantId, organizationId },
        { orderBy: { createdAt: 'asc' } },
        dscope,
      )
    : []
  const deliveries: OutboundDelivery[] = sendSeparately
    ? separateParticipants.map((participant) => ({ externalParticipantId: participant.id, to: [participant.email] }))
    : [{ externalParticipantId: null, to: input.to }]

  await persistOutboundDelivery(em, actor, channel, {
    messageId,
    messageThreadId,
    subject: input.subject,
    plain: input.body.plain ?? messageBody,
    html: input.body.html,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    inReplyTo: input.inReplyTo ?? null,
    references: input.references ?? [],
    channelMetadata: input.channelMetadata,
    parentMessageId: input.parentMessageId ?? null,
    attachments: storedAttachments,
    deliveries,
  })
  await enqueueCommittedDeliveries(messageId, dscope, deliveries)

  return {
    ok: true,
    messageId,
    threadId: messageThreadId,
    channelId: channel.id,
    providerKey: channel.providerKey,
  }
}

type OutboundDelivery = { externalParticipantId: string | null; to: string[] }

/** The links are already committed, so a queue failure leaves the dispatch to the retry tick instead of failing the send. */
async function enqueueCommittedDeliveries(
  messageId: string,
  dscope: Parameters<typeof enqueueOutboundDeliveries>[1],
  deliveries: OutboundDelivery[],
): Promise<void> {
  try {
    await enqueueOutboundDeliveries(messageId, dscope, deliveries)
  } catch (err) {
    logger.warn('Outbound delivery could not be queued; the retry tick will dispatch it', { messageId, err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'communication_channels',
      code: 'communication_channels.outbound_enqueue_failed',
      attributes: { messageId },
    })
  }
}

type OutboundDeliveryContent = {
  messageId: string
  messageThreadId: string
  subject: string
  plain: string
  html?: string
  cc: string[]
  bcc: string[]
  inReplyTo: string | null
  references: string[]
  channelMetadata?: Record<string, unknown>
  parentMessageId: string | null
  attachments: StoredOutboundAttachment[]
  deliveries: OutboundDelivery[]
}

/** The actor owns `channelId` and it can deliver right now. */
async function resolveSendableChannel(
  em: EntityManager,
  actor: SendAsUserActor,
  channelId: string,
): Promise<{ ok: true; channel: CommunicationChannel } | SendAsUserFailure> {
  const dscope = { tenantId: actor.tenantId, organizationId: actor.organizationId }
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: channelId, ...dscope, deletedAt: null },
    undefined,
    dscope,
  )
  if (!channel) return { ok: false, status: 404, error: 'Channel not found', code: 'channel_unavailable' }
  if (channel.userId !== actor.userId) {
    return { ok: false, status: 403, error: 'You can only send through channels you own', code: 'channel_unavailable' }
  }

  // Hub mutation guard: map known non-deliverable states (`requires_reauth`,
  // `disconnected`) to a 422 with field-level errors; other transitional states
  // fall through to the 409 below.
  try {
    await guardOutboundCreate(em, { channelId: channel.id, scope: dscope })
  } catch (err) {
    if (err instanceof ChannelMutationBlockedError) {
      return { ok: false, status: 422, error: err.message, fieldErrors: err.errors, code: 'channel_unavailable' }
    }
    throw err
  }
  if (!channel.isActive || channel.status !== 'connected') {
    return {
      ok: false,
      status: 409,
      error: `Channel is in status '${channel.status}' (not connected)`,
      code: 'channel_unavailable',
    }
  }
  return { ok: true, channel }
}

/**
 * DI-exposed (`communicationChannelsValidateSenderChannel`) so a caller can
 * refuse a mailbox up front, e.g. when a message is scheduled for later.
 */
export async function validateSenderChannel(
  container: AppContainer,
  actor: SendAsUserActor,
  channelId: string,
): Promise<{ ok: true; supportsAttachments: boolean } | SendAsUserFailure> {
  const em = (container.resolve('em') as EntityManager).fork()
  const resolved = await resolveSendableChannel(em, actor, channelId)
  if (!resolved.ok) return resolved
  const adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  return { ok: true, supportsAttachments: adapterRegistry.get(resolved.channel.providerKey)?.capabilities.fileSharing === true }
}

/**
 * The files an existing message carries at hand-off: its current attachments
 * plus the references a scheduled compose stored. A file removed before the
 * send is not sent; any other refusal (no file support, limits) fails the send.
 */
async function resolveExistingMessageAttachments(
  container: AppContainer,
  em: EntityManager,
  actor: SendAsUserActor,
  channel: CommunicationChannel,
  message: Message,
): Promise<{ ok: true; stored: StoredOutboundAttachment[] } | SendAsUserFailure> {
  const { tenantId, organizationId } = actor
  const current = await getMessageAttachments(em, message.id, organizationId, tenantId)
  const storedRefs = readStoredOutboundAttachments(message.senderDeliveryOptions?.channelMetadata)
  if (!current.length && !storedRefs.length) return { ok: true, stored: [] }
  const adapterRegistry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  const adapter = adapterRegistry.get(channel.providerKey)
  if (!adapter) return { ok: false, status: 409, error: '[internal] No channel adapter registered for this provider' }
  const scope = { userId: actor.userId, tenantId, organizationId }
  const refs: OutboundAttachmentRef[] = current.map((attachment) => ({
    kind: 'attachment',
    attachmentId: attachment.id,
    owner: { entityId: MESSAGE_ATTACHMENT_ENTITY_ID, recordId: message.id },
  }))
  for (const storedRef of storedRefs) {
    if (refs.some((ref) => ref.attachmentId === storedRef.attachmentId)) continue
    const ref: OutboundAttachmentRef = { kind: 'attachment', ...storedRef }
    const check = await validateOutboundAttachments({ container, scope, refs: [ref], capabilities: adapter.capabilities })
    if (check.ok || check.code !== 'attachment_not_found') refs.push(ref)
  }
  const validation = await validateOutboundAttachments({ container, scope, refs, capabilities: adapter.capabilities })
  if (!validation.ok) return { ok: false, status: validation.status, error: validation.error, code: validation.code }
  return { ok: true, stored: validation.stored }
}

class ExistingMessageHandOffRefused extends Error {
  constructor(readonly failure: SendAsUserFailure) {
    super(`[internal] ${failure.error}`)
  }
}

/**
 * Re-checks the hand-off under a row lock on the message, inside the link
 * transaction: a concurrent hand-off waits here and then sees the committed
 * link, and a release worker whose claim was taken over sees the new attempt
 * count, so only one of them creates links.
 */
async function assertExistingMessageStillHandedOff(
  trx: EntityManager,
  messageId: string,
  expectedReleaseAttempts: number | undefined,
  dscope: { tenantId: string; organizationId: string | null },
): Promise<void> {
  const locked = await findOneWithDecryption(
    trx,
    Message,
    { id: messageId, ...dscope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    dscope,
  )
  const claimLost = expectedReleaseAttempts !== undefined
    && (locked?.status !== 'releasing' || locked.scheduledReleaseAttempts !== expectedReleaseAttempts)
  if (!locked || claimLost || (locked.isDraft && locked.status !== 'releasing')) {
    throw new ExistingMessageHandOffRefused({ ok: false, status: 409, error: 'Message is no longer being released', code: 'release_superseded' })
  }
  const linked = await findOneWithDecryption(
    trx,
    MessageChannelLink,
    { messageId, direction: 'outbound', ...dscope },
    undefined,
    dscope,
  )
  if (linked) {
    throw new ExistingMessageHandOffRefused({ ok: false, status: 409, error: 'Message is already linked to a channel delivery', code: 'already_linked' })
  }
}

async function sendExistingMessageAsUser(
  container: AppContainer,
  actor: SendAsUserActor,
  input: SendAsUserExistingMessageInput,
): Promise<SendAsUserResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const { tenantId } = actor
  const organizationId = actor.organizationId
  const dscope = { tenantId, organizationId }

  const message = await findOneWithDecryption(
    em,
    Message,
    { id: input.messageId, tenantId, organizationId, deletedAt: null },
    undefined,
    dscope,
  )
  if (!message) return { ok: false, status: 404, error: 'Message not found' }
  if (message.senderUserId !== actor.userId) {
    return { ok: false, status: 403, error: 'You can only send your own messages' }
  }
  if (message.visibility !== 'public') {
    return { ok: false, status: 422, error: 'Only a message addressed to external recipients can be sent through a channel' }
  }
  // A scheduled message is handed over while the release worker holds it as `releasing`.
  if (message.isDraft && message.status !== 'releasing') return { ok: false, status: 409, error: 'Message has not been sent yet' }
  const existingLink = await findOneWithDecryption(
    em,
    MessageChannelLink,
    { messageId: message.id, direction: 'outbound', tenantId, organizationId },
    undefined,
    dscope,
  )
  if (existingLink) {
    return { ok: false, status: 409, error: 'Message is already linked to a channel delivery', code: 'already_linked' }
  }

  const resolved = await resolveSendableChannel(em, actor, input.userChannelId)
  if (!resolved.ok) return resolved
  const { channel } = resolved

  const participants = await findWithDecryption(
    em,
    MessageExternalParticipant,
    { messageId: message.id, tenantId, organizationId },
    { orderBy: { createdAt: 'asc' } },
    dscope,
  )
  const toParticipants = participants.filter((participant) => participant.role === 'to')
  const to = toParticipants.map((participant) => participant.email)
  const cc = participants.filter((participant) => participant.role === 'cc').map((participant) => participant.email)
  const bcc = participants.filter((participant) => participant.role === 'bcc').map((participant) => participant.email)
  if (to.length === 0) return { ok: false, status: 422, error: 'At least one recipient is required' }
  const copiesError = await validateSendSeparately({ to, cc, bcc, sendSeparately: message.emailSendSeparately })
  if (copiesError) return copiesError
  const sendSeparately = message.emailSendSeparately && to.length > 1
  const deliveries: OutboundDelivery[] = sendSeparately
    ? toParticipants.map((participant) => ({ externalParticipantId: participant.id, to: [participant.email] }))
    : [{ externalParticipantId: null, to }]
  const stored = message.senderDeliveryOptions ?? null
  const attachments = await resolveExistingMessageAttachments(container, em, actor, channel, message)
  if (!attachments.ok) return attachments
  const html = message.bodyFormat === 'markdown' && message.body.trim()
    ? await renderMarkdownEmailBody(message.body)
    : undefined

  const refused = await persistOutboundDelivery(
    em,
    actor,
    channel,
    {
      messageId: message.id,
      messageThreadId: message.threadId ?? message.id,
      subject: message.subject,
      plain: message.body,
      html,
      cc,
      bcc,
      inReplyTo: input.channelMetadata ? null : stored?.inReplyTo ?? null,
      references: input.channelMetadata ? [] : stored?.references ?? [],
      channelMetadata: input.channelMetadata ?? stored?.channelMetadata,
      parentMessageId: message.parentMessageId ?? null,
      attachments: attachments.stored,
      deliveries,
    },
    async (trx) => {
      await assertExistingMessageStillHandedOff(trx, message.id, input.expectedReleaseAttempts, dscope)
      // Same markers a composed send-as-user message carries, so the outbound
      // bridge, the platform email path, the retry tick and "resend to failed"
      // all treat this message as mailbox-routed.
      await trx.nativeUpdate(
        Message,
        { id: message.id, tenantId, organizationId },
        { sourceEntityType: SEND_AS_USER_SOURCE_ENTITY_TYPE, sourceEntityId: channel.id, emailDeliveryRoute: 'send_as_user' },
      )
      await trx.nativeUpdate(
        MessageExternalParticipant,
        { messageId: message.id, tenantId, organizationId, deliveryStatus: null },
        { deliveryStatus: 'pending' },
      )
    },
  ).then(
    () => null,
    (error: unknown) => {
      if (error instanceof ExistingMessageHandOffRefused) return error.failure
      throw error
    },
  )
  if (refused) return refused
  await enqueueCommittedDeliveries(message.id, dscope, deliveries)

  return {
    ok: true,
    messageId: message.id,
    threadId: message.threadId ?? message.id,
    channelId: channel.id,
    providerKey: channel.providerKey,
  }
}

async function persistOutboundDelivery(
  em: EntityManager,
  actor: SendAsUserActor,
  channel: CommunicationChannel,
  content: OutboundDeliveryContent,
  beforeLinks?: (trx: EntityManager) => Promise<void>,
): Promise<void> {
  const { tenantId } = actor
  const organizationId = actor.organizationId
  const dscope = { tenantId, organizationId }
  const externalThreadRef = buildOutboundConversationRef(content.messageThreadId)

  // Persist the conversation, thread mapping, and channel link as one unit. The
  // conversation's id is DB-generated (`gen_random_uuid()`), so it must be
  // flushed before the mapping/link can reference it — hence the eager flushes
  // rather than `withAtomicFlush` (single trailing flush). `em.transactional`
  // wraps the whole sequence so a mid-way failure rolls back all three writes
  // instead of leaving an orphaned conversation row.
  await em.transactional(async (trx) => {
    // A reply belongs to the conversation its parent lives in on this channel.
    // One logical thread can map to several provider conversations on the same
    // channel, so the thread alone cannot pick the right one.
    let conversation = content.parentMessageId
      ? await findParentConversation(trx, {
          parentMessageId: content.parentMessageId,
          messageThreadId: content.messageThreadId,
          channelId: channel.id,
          scope: dscope,
        })
      : null
    if (!conversation) {
      conversation = await findOneWithDecryption(
        trx,
        ExternalConversation,
        {
          channelId: channel.id,
          externalConversationId: externalThreadRef,
          tenantId,
          organizationId,
        },
        undefined,
        dscope,
      )
    }
    if (!conversation) {
      // The thread may already be mapped on this channel under the provider's own
      // conversation id: an inbound thread, or an earlier send whose `outbound:`
      // placeholder was re-keyed by the delivery command. Reuse that conversation
      // so a follow-up send stays in it instead of opening a parallel one. When
      // the thread spans several conversations here, the oldest one wins.
      const threadMapping = await findOneWithDecryption(
        trx,
        ChannelThreadMapping,
        {
          messageThreadId: content.messageThreadId,
          channelId: channel.id,
          tenantId,
          organizationId,
        },
        { orderBy: { createdAt: 'asc' } },
        dscope,
      )
      if (threadMapping) {
        conversation = await findOneWithDecryption(
          trx,
          ExternalConversation,
          {
            id: threadMapping.externalConversationId,
            channelId: channel.id,
            tenantId,
            organizationId,
          },
          undefined,
          dscope,
        )
      }
    }
    if (!conversation) {
      conversation = trx.create(ExternalConversation, {
        channelId: channel.id,
        externalConversationId: externalThreadRef,
        subject: content.subject,
        assignedUserId: actor.userId,
        tenantId,
        organizationId,
        lastMessageAt: new Date(),
      })
      trx.persist(conversation)
      await trx.flush()
    } else {
      conversation.subject = conversation.subject ?? content.subject
      conversation.assignedUserId = conversation.assignedUserId ?? actor.userId
      conversation.lastMessageAt = new Date()
      // Flush the scalar updates BEFORE the ChannelThreadMapping lookup below: a
      // find/findOne on the same EntityManager between a scalar mutation and flush
      // can silently drop the pending UPDATE (core AGENTS.md → Entity Update Safety).
      await trx.flush()
    }

    const existingMapping = await findOneWithDecryption(
      trx,
      ChannelThreadMapping,
      {
        externalConversationId: conversation.id,
        tenantId,
        organizationId,
      },
      undefined,
      dscope,
    )
    if (!existingMapping) {
      const mapping = trx.create(ChannelThreadMapping, {
        externalConversationId: conversation.id,
        messageThreadId: content.messageThreadId,
        channelId: channel.id,
        providerKey: channel.providerKey,
        externalThreadRef,
        assignedUserId: actor.userId,
        tenantId,
        organizationId,
      })
      trx.persist(mapping)
    }

    if (beforeLinks) await beforeLinks(trx)

    for (const delivery of content.deliveries) {
      const channelLink = trx.create(MessageChannelLink, {
        messageId: content.messageId,
        externalParticipantId: delivery.externalParticipantId,
        externalConversationId: conversation.id,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        direction: 'outbound',
        deliveryStatus: 'pending',
        channelPayload: {
          text: content.plain,
          ...(content.html ? { html: content.html } : {}),
        },
        channelContentType: content.html ? 'text/html' : 'text/plain',
        channelMetadata: {
          // Caller-supplied pass-through metadata merged FIRST so the validated
          // routing fields below always win — a caller cannot override the
          // recipients/subject/threading headers via `channelMetadata`. The
          // attachment refs key is hub-owned: a caller-supplied value is dropped
          // so no ref can skip the checks above.
          ...omitOutboundAttachments(content.channelMetadata),
          to: delivery.to,
          cc: delivery.externalParticipantId ? [] : content.cc,
          bcc: [],
          subject: content.subject,
          inReplyTo: content.inReplyTo,
          references: content.references,
          // Every copy of a "send separately" message carries the files.
          ...(content.attachments.length ? { [OUTBOUND_ATTACHMENTS_METADATA_KEY]: content.attachments } : {}),
        },
        tenantId,
        organizationId,
      })
      trx.persist(channelLink)
    }
    await trx.flush()
  })
}

async function enqueueOutboundDeliveries(
  messageId: string,
  scope: { tenantId: string; organizationId: string | null },
  deliveries: OutboundDelivery[],
): Promise<void> {
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
  for (const delivery of deliveries) {
    const deliveryJob: OutboundDeliveryPayload = {
      messageId,
      scope,
      attempt: 1,
      ...(delivery.externalParticipantId ? { externalParticipantId: delivery.externalParticipantId } : {}),
    }
    await queue.enqueue(deliveryJob as unknown as Record<string, unknown>)
  }
}

/**
 * "Send separately" gives every "to" address its own copy, so a cc/bcc copy
 * would have to go out once per recipient — refused rather than guessed.
 */
export function findSendSeparatelyCopyFields(
  input: Pick<SendAsUserInput, 'to' | 'cc' | 'bcc' | 'sendSeparately'>,
): Array<'cc' | 'bcc'> {
  if (input.sendSeparately !== true || input.to.length <= 1) return []
  return (['cc', 'bcc'] as const).filter((field) => (input[field]?.length ?? 0) > 0)
}

async function validateSendSeparately(
  input: Pick<SendAsUserInput, 'to' | 'cc' | 'bcc' | 'sendSeparately'>,
): Promise<SendAsUserFailure | null> {
  const fields = findSendSeparatelyCopyFields(input)
  if (fields.length === 0) return null
  const { t } = await resolveTranslations()
  const error = t(
    'messages.errors.sendSeparatelyWithCopies',
    'Send separately cannot be combined with CC or BCC when there is more than one recipient.',
  )
  return { ok: false, status: 400, error, fieldErrors: Object.fromEntries(fields.map((field) => [field, error])) }
}

/**
 * The parent's conversation on this channel, but only when it is mapped to the
 * reply's own thread there: delivery resolves the mapping by thread and
 * conversation, so any other conversation would leave the reply undeliverable.
 */
async function findParentConversation(
  em: EntityManager,
  params: {
    parentMessageId: string
    messageThreadId: string
    channelId: string
    scope: { tenantId: string; organizationId: string | null }
  },
): Promise<ExternalConversation | null> {
  const { tenantId, organizationId } = params.scope
  const parentLink = await findOneWithDecryption(
    em,
    MessageChannelLink,
    { messageId: params.parentMessageId, tenantId, organizationId },
    undefined,
    params.scope,
  )
  if (!parentLink) return null
  const parentMapping = await findOneWithDecryption(
    em,
    ChannelThreadMapping,
    {
      externalConversationId: parentLink.externalConversationId,
      messageThreadId: params.messageThreadId,
      channelId: params.channelId,
      tenantId,
      organizationId,
    },
    undefined,
    params.scope,
  )
  if (!parentMapping) return null
  return findOneWithDecryption(
    em,
    ExternalConversation,
    { id: parentMapping.externalConversationId, channelId: params.channelId, tenantId, organizationId },
    undefined,
    params.scope,
  )
}

/** DI service type for cross-module callers (resolve `communicationChannelsSendAsUser`). */
export type SendAsUserService = typeof sendAsUser
/** DI service type for cross-module callers (resolve `communicationChannelsValidateSenderChannel`). */
export type ValidateSenderChannelService = typeof validateSenderChannel
