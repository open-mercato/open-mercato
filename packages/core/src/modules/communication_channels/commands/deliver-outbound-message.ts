import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { classifyOutboundError, isReauthError } from '../lib/error-classification'
import {
  buildBodyFooter,
  buildReferencesId,
  getOrCreateThreadToken,
} from '../lib/thread-token'
import { parseReferences, referencesFromMeta, stringOrUndefined, stripBrackets } from '../lib/email-mime'
import { validateOutboundRecipient } from '../lib/outbound-recipient'
import { resolveOutboundReplyExternalId, stripCallerReplyTargeting } from '../lib/outbound-reply-ref'
import {
  OutboundAttachmentDeliveryError,
  loadOutboundAttachments,
  omitOutboundAttachments,
  readStoredOutboundAttachments,
} from '../lib/outbound-attachments'
import { adoptProviderConversationRef, isOutboundConversationRef } from '../lib/outbound-conversation-ref'
import { resolveOutboundRouting } from '../lib/outbound-routing'
import type { ChannelAdapterRegistry } from '../lib/registry'
import { isUniqueViolation } from '../lib/pg-errors'
import { Message, MessageExternalParticipant } from '../../messages/data/entities'
import {
  DELIVERY_WINDOW_EXCEEDED_ERROR,
  planTransientRetry,
  recordExternalDeliverySummary,
  settleExternalParticipants,
  type ExternalParticipantSettlement,
} from '../../messages/lib/externalParticipants'
import { ensureMessagesEmailRetrySchedule } from '../../messages/lib/emailRetrySchedule'
import { SEND_AS_USER_SOURCE_ENTITY_TYPE } from '../../messages/lib/messageSourceEntityTypes'
import {
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const moduleLogger = createLogger('communication_channels').child({ component: 'deliver-outbound-message' })
const MAX_EMAIL_REPLY_REFERENCES = 40

/**
 * Sentinel — `Message.threadId` of an internal-only (no channel link) message
 * has no matching `ChannelThreadMapping`. In that case outbound delivery is a no-op.
 */
const NO_THREAD_MAPPING_RESULT = { status: 'no_channel_link' as const }

const deliverInputSchema = z.object({
  messageId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
  /**
   * If true, force a credential refresh before sending — used by retry attempts
   * after a 401 from the provider.
   */
  forceCredentialRefresh: z.boolean().optional(),
  /**
   * Delivers the "send separately" link of this participant. Omitted/null
   * delivers the message's joint link (one send to every participant).
   */
  externalParticipantId: z.string().uuid().nullable().optional(),
  /**
   * Retry delay the worker wants for a transient failure on this attempt (its
   * short in-process backoff). Omitted means the configured retry delay.
   */
  transientRetryDelayMs: z.number().int().nonnegative().optional(),
})

export type DeliverOutboundMessageInput = z.infer<typeof deliverInputSchema>

export type DeliverOutboundMessageResult =
  | { status: 'no_channel_link' }
  | { status: 'already_delivered'; messageId: string; channelLinkId: string }
  /** Every participant of the link is settled, or another delivery holds them until a later attempt. */
  | { status: 'not_due'; messageId: string; channelLinkId: string }
  | {
      status: 'delivered'
      messageId: string
      channelLinkId: string
      externalMessageId: string
      providerKey: string
    }
  | {
      status: 'failed'
      messageId: string
      channelLinkId: string
      providerKey: string
      error: string
      transient: boolean
      /**
       * True when the failure was a 401 / invalid_grant — the channel was
       * flipped to `requires_reauth`. The worker uses this to attempt one
       * forced credential refresh before giving up.
       */
      requiresReauth: boolean
      /**
       * Present when the link has participants: their state owns the retry
       * schedule. `nextAttemptAt` (ISO) is set while any of them stays pending.
       */
      participantDelivery?: { nextAttemptAt: string | null }
    }

const PARTICIPANT_CLAIM_LOCK_MS = 15 * 60 * 1000

export const COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID =
  'communication_channels.message.deliver_outbound'

function omitRawMessage(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {}
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'rawMessage'))
}

function addressSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(
    value
      .map((entry) => (typeof entry === 'string' ? entry : (entry as { address?: unknown } | null)?.address))
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase()),
  )
}

/**
 * Splits the link's participants by the provider's verdict. Adapters that report
 * per-address results (SMTP/IMAP `metadata.accepted`/`rejected`) decide per
 * participant; a whole-message acceptance (Gmail, test-seed) marks all of them sent.
 */
export function splitParticipantsByDeliveryResult<T extends { email: string }>(
  participants: T[],
  resultMetadata: Record<string, unknown> | undefined,
): { sent: T[]; rejected: T[] } {
  const rejectedAddresses = addressSet(resultMetadata?.rejected)
  const sent: T[] = []
  const rejected: T[] = []
  for (const participant of participants) {
    if (rejectedAddresses.has(participant.email.trim().toLowerCase())) rejected.push(participant)
    else sent.push(participant)
  }
  return { sent, rejected }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

type IntegrationLogLike = {
  log?: (entry: Record<string, unknown>) => Promise<void> | void
  warn?: (entry: Record<string, unknown>) => Promise<void> | void
  error?: (entry: Record<string, unknown>) => Promise<void> | void
}

/**
 * Outbound delivery command. Called from the outbound worker.
 *
 * Steps (SPEC-045d §7):
 *   1. Re-fetch the Message by ID. Bail if internal-only (no ChannelThreadMapping).
 *   2. Resolve channel + adapter + credentials.
 *   3. Idempotently upsert a 'pending' MessageChannelLink — one joint link per
 *      message, or one per participant for a "send separately" delivery.
 *      Skip if a 'sent'/'delivered' link already exists.
 *   4. Refresh credentials when OAuth + near expiry (or when caller forces it).
 *   5. Call `adapter.convertOutbound(...)` → channel-native content.
 *   6. Call `adapter.sendMessage(...)`.
 *   7. On success: persist ExternalMessage + flip link to 'sent', emit `.message.sent`.
 *   8. On failure: flip link to 'failed' + classify error, log to integrationLog,
 *      emit `.delivery_failed`. The worker decides whether to retry based on
 *      `result.transient`.
 *
 * Idempotency: the partial unique indexes on `message_channel_links`
 * (`message_id` for the joint link, `(message_id, external_participant_id)` per participant)
 * prevent the same Message being sent twice through the channel even if the
 * subscriber fires repeatedly. Combined with the link's lifecycle state
 * (pending → sent | failed), we get safe retries.
 */
const deliverOutboundMessageCommand: CommandHandler<
  DeliverOutboundMessageInput,
  DeliverOutboundMessageResult
> = {
  id: COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = deliverInputSchema.parse(rawInput) as DeliverOutboundMessageInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    // (1) Re-fetch Message by ID — never trust the event payload shape.
    const message = await findOneWithDecryption(
      em,
      Message,
      {
        id: input.messageId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (!message) {
      // Message was deleted before we got to deliver. Treat as no-op.
      return NO_THREAD_MAPPING_RESULT
    }
    if (!message.threadId) {
      // Message has no thread → no channel routing.
      return NO_THREAD_MAPPING_RESULT
    }

    const linkFilter = {
      messageId: message.id,
      externalParticipantId: input.externalParticipantId ?? null,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }
    let link = await findOneWithDecryption(em, MessageChannelLink, linkFilter, undefined, dscope)

    if (link && ['queued', 'sent', 'delivered', 'read'].includes(link.deliveryStatus)) {
      return { status: 'already_delivered', messageId: message.id, channelLinkId: link.id }
    }

    const routing = await resolveOutboundRouting(em, { message, link, scope: dscope })
    if (!routing) return NO_THREAD_MAPPING_RESULT
    const { mapping, channel } = routing

    if (!channel.isActive) {
      throw new Error(`[internal] Channel ${mapping.channelId} is inactive; refusing to deliver outbound`)
    }

    const adapterRegistry = ctx.container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
    const adapter = adapterRegistry.get(channel.providerKey)
    if (!adapter) {
      throw new Error(
        `[internal] No ChannelAdapter registered for providerKey '${channel.providerKey}'. ` +
          'Check that the provider package is enabled in modules.ts.',
      )
    }

    if (!link) {
      link = em.create(MessageChannelLink, {
        messageId: message.id,
        externalParticipantId: input.externalParticipantId ?? null,
        externalConversationId: mapping.externalConversationId,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        direction: 'outbound',
        deliveryStatus: 'pending',
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      })
      em.persist(link)
      try {
        await em.flush()
      } catch (flushErr) {
        // Concurrency guard: the link lookup above is not atomic with this
        // insert, so two deliveries of the same message (a replayed
        // `messages.message.sent`, or an overlapping worker retry) can both
        // reach here. The partial unique index on `(message_id)` for a joint
        // link, or `(message_id, external_participant_id)` for a separate one, rejects the
        // loser with a 23505. Defer to the winning job — re-read its link on a
        // fresh fork and report `already_delivered` — instead of re-invoking the
        // adapter (double send) or letting the raw error dead-letter the job.
        if (isUniqueViolation(flushErr)) {
          const winner = await findOneWithDecryption(em.fork(), MessageChannelLink, linkFilter, undefined, dscope)
          if (winner) {
            return {
              status: 'already_delivered',
              messageId: message.id,
              channelLinkId: winner.id,
            }
          }
        }
        throw flushErr
      }
    }

    // Participants are the source of truth for addressing: one for a separate
    // link, all still-pending ones for a joint link. The claim pushes their
    // `next_attempt_at` past a lock window so a retry-tick duplicate cannot send
    // twice. Legacy messages without status-bearing participant rows keep the
    // recipients stored on the link.
    const participantScope = {
      messageId: message.id,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }
    const linkParticipantFilter = {
      ...participantScope,
      ...(link.externalParticipantId ? { id: link.externalParticipantId } : {}),
    }
    const claimNow = new Date()
    const claimUntil = new Date(claimNow.getTime() + PARTICIPANT_CLAIM_LOCK_MS)
    const claimedCount = await em.nativeUpdate(
      MessageExternalParticipant,
      {
        ...linkParticipantFilter,
        deliveryStatus: 'pending',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: claimNow } }],
      },
      { nextAttemptAt: claimUntil },
    )
    const claimedUntil = claimedCount > 0 ? claimUntil : null
    if (!claimedUntil && (await em.count(MessageExternalParticipant, { ...linkParticipantFilter, deliveryStatus: { $ne: null } })) > 0) {
      return { status: 'not_due', messageId: message.id, channelLinkId: link.id }
    }
    const participants = await findWithDecryption(
      em,
      MessageExternalParticipant,
      claimedUntil ? { ...linkParticipantFilter, deliveryStatus: 'pending', nextAttemptAt: claimedUntil } : linkParticipantFilter,
      { orderBy: { createdAt: 'asc' } },
      dscope,
    )
    const participantAddresses = (role: MessageExternalParticipant['role']) =>
      participants.filter((participant) => participant.role === role).map((participant) => participant.email)
    const participantRouting = participants.length > 0
      ? { to: participantAddresses('to'), cc: participantAddresses('cc'), bcc: participantAddresses('bcc') }
      : null

    // (2 cont.) Decrypted credentials via the integrations module (if available).
    let credentialsService: CredentialsServiceLike | null = null
    try {
      credentialsService = ctx.container.resolve(
        'integrationCredentialsService',
      ) as CredentialsServiceLike
    } catch {
      credentialsService = null
    }
    // Per-user credentials scope: pass `channel.userId` so the credentials
    // service returns this user's row, not whoever connected last. See
    // review R2-C1 / N1 (2026-05-26).
    //
    // Key the org on the CHANNEL's own org, not the message's org. Tenant-wide
    // channels store `organization_id = NULL` and their credentials live at
    // `organization_id = tenantId` (see connect-credential-channel.ts), so
    // `channel.organizationId ?? tenantId` matches the write key for both
    // org-scoped and tenant-wide channels. Keying on the message org would
    // resolve `{}` the moment a tenant-wide provider delivers from a message
    // that carries a non-null org.
    const credentialsScope = {
      tenantId: input.scope.tenantId,
      organizationId: channel.organizationId ?? input.scope.tenantId,
      userId: channel.userId ?? null,
    }
    let credentials: Record<string, unknown> = {}
    if (channel.credentialsRef && credentialsService) {
      try {
        credentials =
          (await credentialsService.resolve(`channel_${channel.providerKey}`, credentialsScope)) ?? {}
      } catch {
        credentials = {}
      }
    }

    // (4) Credential refresh if OAuth + near expiry, or forced by retry.
    let integrationLog: IntegrationLogLike | null = null
    try {
      integrationLog = ctx.container.resolve('integrationLogService') as IntegrationLogLike
    } catch {
      integrationLog = null
    }
    const refreshResult = await refreshCredentialsIfNeeded(
      {
        adapter,
        channelId: channel.id,
        credentials,
        scope: credentialsScope,
        force: Boolean(input.forceCredentialRefresh),
      },
      {
        credentialsService,
        logger: (...args) => moduleLogger.warn('credential refresh diagnostic', { details: args }),
      },
    )
    credentials = refreshResult.credentials

    // (4b) Spec B — get-or-create the per-thread crypto token and inject it
    // into the outbound payload BEFORE the adapter converts it. The token
    // travels as both a `References` header (via channelMetadata.references)
    // and a hidden body marker so inbound replies can be threaded back to
    // this conversation even when the recipient's MUA strips RFC 5322
    // headers. Idempotent on retry — same token reused per thread.
    let threadToken: string | null = null
    try {
      const { token } = await getOrCreateThreadToken(em, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        messageThreadId: mapping.messageThreadId,
      })
      threadToken = token
    } catch (tokenErr) {
      // Token creation should never block a send — if it fails, the message
      // still goes out, just without our thread-token attachment point.
      // Threading falls back to the JWZ strategy via Message-Id headers.
      moduleLogger.warn('thread token unavailable, proceeding without it', { err: tokenErr })
    }

    // (4c) Chat-provider reply threading — resolve the provider-native id of the
    // message this one answers so a threading adapter can attach it (Discord's
    // `message_reference`). Email adapters ignore this and keep threading on the
    // `inReplyTo` / `references` headers built above. Best-effort like the thread
    // token: an unresolvable parent sends an unthreaded reply rather than failing
    // a delivery.
    let replyToExternalId: string | null = null
    try {
      replyToExternalId = await resolveOutboundReplyExternalId(em, {
        parentMessageId: message.parentMessageId ?? null,
        externalConversationId: mapping.externalConversationId,
        capabilities: adapter.capabilities,
        scope: {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
      })
    } catch (replyRefErr) {
      moduleLogger.warn('outbound reply reference unavailable, sending unthreaded', {
        err: replyRefErr,
      })
    }
    if (!replyToExternalId && message.parentMessageId && adapter.capabilities?.threading === true) {
      // The provider threads and the caller asked for a reply, yet nothing
      // resolved — the parent never reached this channel, or it belongs to
      // another conversation. Delivery is unaffected, but say so: an unthreaded
      // reply is otherwise indistinguishable from a non-reply, which is exactly
      // the silent-unreachability shape #5541 was filed about.
      moduleLogger.debug('reply parent has no external id on this channel, sending unthreaded', {
        messageId: message.id,
        parentMessageId: message.parentMessageId,
        conversationId: mapping.externalConversationId,
      })
    }

    // (5) + (6) Convert + send.
    try {
      const outboundPayload = (link.channelPayload as Record<string, unknown> | null) ?? {}
      const outboundHtml = typeof outboundPayload.html === 'string' ? outboundPayload.html : null
      const outboundText = typeof outboundPayload.text === 'string' ? outboundPayload.text : null
      let outboundBody = outboundHtml ?? outboundText ?? message.body ?? ''
      const outboundBodyFormat = outboundHtml
        ? 'html'
        : ((message.bodyFormat as 'text' | 'markdown' | 'html') ?? 'text')

      let baseMetadata = link.channelMetadata ?? {}
      const replyRecipient = message.externalEmail
      if (
        baseMetadata.to == null &&
        channel.channelType === 'email' &&
        message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE &&
        message.sourceEntityId === channel.id &&
        message.parentMessageId &&
        replyRecipient && validateOutboundRecipient(replyRecipient, null).ok
      ) {
        const parentLink = await findOneWithDecryption(
          em,
          MessageChannelLink,
          {
            messageId: message.parentMessageId,
            externalConversationId: mapping.externalConversationId,
            providerKey: channel.providerKey,
            channelType: 'email',
            direction: 'outbound',
            ...dscope,
          },
          undefined,
          dscope,
        )
        if (parentLink) {
          const parentMetadata = parentLink.channelMetadata ?? {}
          const { deliveryStatus } = parentLink
          const parentInFlight = !parentLink.externalMessageId && (deliveryStatus === 'pending' || deliveryStatus === 'queued')
          const parentProviderConversationId = stringOrUndefined(parentMetadata.providerConversationId)
          const awaitingThreadRef = isOutboundConversationRef(mapping.externalThreadRef) &&
            parentProviderConversationId && !isOutboundConversationRef(parentProviderConversationId)
          if (parentInFlight || awaitingThreadRef) {
            throw Object.assign(new Error('[internal] Waiting for the parent email to finish sending'), { transient: true })
          }
          if (deliveryStatus === 'failed' && !parentLink.externalMessageId) {
            throw Object.assign(new Error('[internal] Parent email delivery failed'), { transient: parentMetadata.transient === true })
          }
          const inReplyTo = stripBrackets(stringOrUndefined(parentMetadata.messageId))
          const references = new Set(parseReferences(referencesFromMeta(parentMetadata.references)))
          if (inReplyTo) {
            references.delete(inReplyTo)
            references.add(inReplyTo)
          }
          baseMetadata = {
            ...baseMetadata,
            to: [replyRecipient],
            subject: message.subject,
            inReplyTo,
            references: [...references].slice(-MAX_EMAIL_REPLY_REFERENCES),
          }
        }
      }
      let mergedReferences = referencesFromMeta(baseMetadata.references) ?? []
      // The footer + References-id are the email-threading fallback for a
      // recipient whose client strips RFC 5322 headers — meaningless for a
      // provider-native conversation, where the hub already threads on the
      // provider's own conversation id. Emitting it anyway would hand a
      // real Discord/Slack/etc. user a visible, copyable thread marker they
      // could paste into an unrelated conversation to graft it onto this
      // one (the token/JWZ matcher is likewise gated off inbound for these
      // providers in `ingest-inbound-message.ts`).
      const isProviderNativeChannel = adapter.capabilities.recipientFormat === 'provider-native'
      if (!isProviderNativeChannel && threadToken && !outboundBody.includes(`[OM:${threadToken}]`)) {
        // Append the body footer for the corresponding format. The hidden
        // HTML span is `display:none`; the plain-text trailer is a small
        // bracketed marker on its own line. Both survive most reply clients.
        const footer = buildBodyFooter(threadToken)
        if (outboundBodyFormat === 'html') {
          const closingBody = outboundBody.lastIndexOf('</body>')
          outboundBody =
            closingBody >= 0
              ? `${outboundBody.slice(0, closingBody)}${footer.html}${outboundBody.slice(closingBody)}`
              : `${outboundBody}${footer.html}`
        } else {
          outboundBody = `${outboundBody}${footer.plain}`
        }
        const refId = buildReferencesId(threadToken)
        if (!mergedReferences.includes(refId)) {
          mergedReferences = [...mergedReferences, refId]
        }
      }
      // Attachment bytes are read here, on every attempt, for the channel owner
      // the send-as-user facade authorized; a file that is gone or no longer
      // fits fails the delivery permanently rather than sending without it.
      const storedAttachments = readStoredOutboundAttachments(baseMetadata)
      if (storedAttachments.length && !channel.userId) {
        throw new OutboundAttachmentDeliveryError('attachment_unavailable')
      }
      const attachments = storedAttachments.length
        ? await loadOutboundAttachments({
            container: ctx.container,
            scope: {
              userId: channel.userId as string,
              tenantId: input.scope.tenantId,
              organizationId: input.scope.organizationId ?? null,
            },
            stored: storedAttachments,
            capabilities: adapter.capabilities,
          })
        : undefined
      const converted = await adapter.convertOutbound({
        body: outboundBody,
        bodyFormat: outboundBodyFormat,
        ...(attachments ? { attachments } : {}),
        channelMetadata: {
          thread_id: mapping.externalThreadRef,
          // Reply targeting is hub-resolved only. `send-as-user` merges
          // caller-supplied metadata onto the link, so every reply-targeting key
          // is stripped off the stored metadata here rather than merely
          // out-ranked below: merge order settles the contest only when the hub
          // resolved a parent, and the uncontested case — no `parentMessageId`,
          // or a parent that does not resolve — is exactly the one a caller
          // controls.
          ...stripCallerReplyTargeting(omitOutboundAttachments(baseMetadata)),
          ...(participantRouting ?? {}),
          references: mergedReferences,
          ...(threadToken ? { omThreadToken: threadToken } : {}),
          ...(replyToExternalId ? { replyToExternalId } : {}),
        },
      })

      // NOTE — at-least-once delivery (accepted v1 semantics). This provider
      // send is a non-transactional external side effect. The terminal-status
      // short-circuit above and the per-link partial unique indexes
      // prevent duplicate link records and re-sends after a *completed*
      // delivery, but if the process crashes in the narrow window between this
      // call returning and the success flush below, the link stays `pending`
      // and a worker retry re-invokes the adapter — the recipient may receive a
      // duplicate. This is deliberate: email providers (Gmail/SMTP) expose no
      // idempotent-send key nor a reliable "did message X send?" query, so
      // re-sending is preferred over risking a dropped message.
      const sendResult = await adapter.sendMessage({
        conversationId: mapping.externalThreadRef,
        content: converted.content,
        credentials,
        scope: {
          tenantId: input.scope.tenantId,
          organizationId: channel.organizationId ?? input.scope.tenantId,
        },
        metadata: converted.metadata,
      })

      const resultMetadata = sendResult.metadata as Record<string, unknown> | undefined
      const participantOutcome = splitParticipantsByDeliveryResult(participants, resultMetadata)
      // A partial rejection (SMTP/IMAP report the accepted/rejected split) is a
      // send: the accepted participants got the mail, only the rejected ones fail.
      const partiallyAccepted =
        sendResult.status === 'failed' && addressSet(resultMetadata?.accepted).size > 0 && participantOutcome.sent.length > 0
      if (sendResult.status === 'failed' && !partiallyAccepted) {
        throw Object.assign(new Error(sendResult.error ?? `Adapter '${adapter.providerKey}' reported send failure`), {
          ...(sendResult.transient !== undefined ? { transient: sendResult.transient } : {}),
          ...(sendResult.retryAt ? { retryAt: sendResult.retryAt } : {}),
        })
      }

      // (7) Persist success records.
      //
      // Pre-generate the ExternalMessage PK client-side. The PK uses
      // `defaultRaw: 'gen_random_uuid()'`, so `externalMessage.id` is undefined
      // until after the INSERT returns — writing `link.externalMessageId =
      // externalMessage.id` before the flush would silently persist NULL on the
      // link's FK. Mirrors the inbound ingest path (ingest-inbound-message.ts).
      const externalMessageRowId = randomUUID()
      const externalMessage = em.create(ExternalMessage, {
        id: externalMessageRowId,
        channelId: channel.id,
        conversationId: mapping.externalConversationId,
        externalMessageId: sendResult.externalMessageId,
        direction: 'outbound',
        senderIdentifier: null,
        senderDisplayName: null,
        providerTimestamp: new Date(),
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      })
      em.persist(externalMessage)

      // A successful send proves the credentials are valid — clear any prior
      // `requires_reauth` / `error` state so a recovered channel doesn't keep
      // showing a stale reconnect banner (e.g. after a forced-refresh retry).
      if (channel.status === 'requires_reauth' || channel.status === 'error') {
        channel.status = 'connected'
      }

      const providerConversationId = stringOrUndefined(sendResult.conversationId)
      // A partially accepted send (status `failed`) reaches this point as a send.
      link.deliveryStatus = sendResult.status === 'queued' ? 'queued' : 'sent'
      link.externalMessageId = externalMessageRowId
      // The actual per-link to/cc stay on the link as a snapshot for the CRM
      // enricher (`toAddresses`/`ccAddresses`); bcc is never written back.
      const deliveredMetadata: Record<string, unknown> = {
        ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        ...omitRawMessage(converted.metadata),
        ...(participantRouting ? { to: participantRouting.to, cc: participantRouting.cc } : {}),
      }
      if (participantRouting) delete deliveredMetadata.bcc
      link.channelMetadata = {
        ...deliveredMetadata,
        externalMessageId: sendResult.externalMessageId,
        // Always persist the RFC2822 Message-ID so inbound reply matching (JWZ
        // strategy in lib/thread-matcher) and sent-folder dedup can resolve this
        // outbound message. Adapters that build the message themselves (Gmail)
        // return it in `converted.metadata.messageId`; IMAP/SMTP lets
        // the transport mint it, surfacing it only as `sendResult.externalMessageId`
        // (the RFC2822 id the recipient replies to) — fall back to that.
        // Store it bracket-stripped to match the inbound convention
        // (`normalizeMimeInbound` strips), so the JWZ matcher and sent-folder dedup —
        // which compare against stripped ids — resolve it. The MIME composer
        // re-applies brackets when this id is later used to build reply headers.
        // A provider that rewrites the header on send (Gmail mints its own
        // Message-ID) reports the id it actually sent in `sendResult.metadata.messageId`;
        // that one wins, because it is the id the provider's copy and every reply carry.
        messageId: stripBrackets(
          stringOrUndefined((sendResult.metadata as Record<string, unknown> | undefined)?.messageId) ??
            stringOrUndefined((converted.metadata as Record<string, unknown> | undefined)?.messageId) ??
            sendResult.externalMessageId,
        ),
        // The provider conversation this message was actually sent under. The
        // shared conversation can be re-keyed to a different provider ref by a
        // concurrent first send (see `adoptProviderConversationRef`), so the
        // message keeps its own association here instead of relying on the
        // conversation's ref.
        ...(providerConversationId ? { providerConversationId } : {}),
      }
      await em.flush()

      if (participants.length > 0) {
        const rejectionError = sendResult.error ?? 'Rejected by the mail server'
        await settleExternalParticipants(
          em,
          participantScope,
          {
            sent: participantOutcome.sent.map((participant) => participant.id),
            failed: participantOutcome.rejected.map((participant) => ({ id: participant.id, error: rejectionError })),
          },
          { claimedUntil },
        )
        await recordExternalDeliverySummary(em, participantScope, { sentAt: new Date() })
      }

      // A first send through `sendAsUser` sits in an `outbound:<thread>` placeholder
      // conversation. Adopt the provider's own conversation id so the provider's copy
      // of this message and the replies to it land in this conversation instead of
      // opening a second one. Best-effort and after the success flush: the message is
      // already sent, so a failure here must never turn into a retry (double send).
      try {
        const adoption = await adoptProviderConversationRef(em, {
          mapping,
          channelId: channel.id,
          providerConversationRef: sendResult.conversationId,
          scope: dscope,
        })
        if (adoption === 'conflict') {
          moduleLogger.info('provider conversation id already belongs to another conversation, keeping the outbound placeholder', {
            messageId: message.id,
            channelId: channel.id,
            conversationId: mapping.externalConversationId,
            providerConversationId,
          })
        }
      } catch (adoptErr) {
        moduleLogger.warn('could not adopt the provider conversation id, keeping the outbound placeholder', {
          messageId: message.id,
          conversationId: mapping.externalConversationId,
          err: adoptErr,
        })
        try {
          getTelemetryRuntime()?.reportError(adoptErr, {
            module: 'communication_channels',
            code: 'communication_channels.provider_conversation_adoption_failed',
            attributes: { messageId: message.id, channelId: channel.id },
          })
        } catch (telemetryErr) {
          moduleLogger.warn('could not report a conversation adoption failure to telemetry', { err: telemetryErr })
        }
      }

      await emitCommunicationChannelsEvent(
        'communication_channels.message.sent',
        {
          messageId: message.id,
          externalMessageId: externalMessage.id,
          channelLinkId: link.id,
          conversationId: mapping.externalConversationId,
          channelId: channel.id,
          providerKey: channel.providerKey,
          channelType: channel.channelType,
          direction: 'outbound',
          // #6095: same contract as the inbound path — the send time travels on
          // the event so consumers (the customers timeline) date their rows
          // from it instead of reading the ExternalMessage row across the
          // module boundary. ISO string because this event is persistent.
          providerTimestamp:
            externalMessage.providerTimestamp instanceof Date
              ? externalMessage.providerTimestamp.toISOString()
              : null,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'delivered',
        messageId: message.id,
        channelLinkId: link.id,
        externalMessageId: externalMessage.id,
        providerKey: channel.providerKey,
      }
    } catch (sendErr) {
      // (8) Failure path — classify, persist, emit, return.
      const classification = classifyOutboundError(sendErr)
      const requiresReauth = isReauthError(classification)
      const providerRetryAt = (sendErr as { retryAt?: unknown } | null)?.retryAt
      const settlement = participants.length > 0
        ? planParticipantFailure(participants.map((participant) => participant.id), {
            error: classification.message,
            transient: classification.transient,
            requiresReauth,
            forcedRefresh: Boolean(input.forceCredentialRefresh),
            messageSentAt: message.sentAt ?? null,
            retryAt: providerRetryAt instanceof Date ? providerRetryAt : undefined,
            delayMs: input.transientRetryDelayMs,
          })
        : null
      const retries = settlement?.retry ?? []
      link.deliveryStatus = retries.length > 0 ? 'pending' : 'failed'
      link.channelMetadata = {
        ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        lastError: classification.message,
        lastErrorAt: new Date().toISOString(),
        transient: classification.transient,
        requiresReauth,
      }
      // A 401 / invalid_grant means the stored credentials are dead and no
      // retry will help — flip the channel to `requires_reauth` (mirrors the
      // inbound poll path) so the operator gets a reconnect signal instead of
      // silently-failing sends. A later successful send self-heals back to
      // `connected` (see the success path above).
      if (requiresReauth) {
        channel.status = 'requires_reauth'
      }
      await em.flush()

      if (settlement) {
        await settleExternalParticipants(em, participantScope, settlement, { claimedUntil })
        if (retries.length === 0) {
          await recordExternalDeliverySummary(em, participantScope, { error: classification.message })
        } else {
          await ensureMessagesEmailRetrySchedule(ctx.container, {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId ?? null,
          })
        }
      }

      try {
        await integrationLog?.error?.({
          integrationId: `channel_${channel.providerKey}`,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
          channelId: channel.id,
          messageId: message.id,
          status: classification.status ?? null,
          transient: classification.transient,
          message: classification.message,
        })
      } catch {
        // best-effort logging
      }

      if (requiresReauth) {
        await emitCommunicationChannelsEvent(
          'communication_channels.channel.requires_reauth',
          {
            channelId: channel.id,
            providerKey: channel.providerKey,
            channelType: channel.channelType,
            reason: classification.message,
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId ?? null,
          },
          { persistent: true },
        )
      }

      await emitCommunicationChannelsEvent(
        'communication_channels.message.delivery_failed',
        {
          messageId: message.id,
          channelLinkId: link.id,
          conversationId: mapping.externalConversationId,
          channelId: channel.id,
          providerKey: channel.providerKey,
          channelType: channel.channelType,
          transient: classification.transient,
          error: classification.message,
          status: classification.status ?? null,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'failed',
        messageId: message.id,
        channelLinkId: link.id,
        providerKey: channel.providerKey,
        error: classification.message,
        transient: classification.transient,
        requiresReauth,
        ...(settlement
          ? {
              participantDelivery: {
                nextAttemptAt: retries.length > 0
                  ? new Date(Math.min(...retries.map((entry) => entry.nextAttemptAt.getTime()))).toISOString()
                  : null,
              },
            }
          : {}),
      }
    }
  },
}

/**
 * Participant outcome of a failed link delivery. A reauth failure is retried once
 * right away (the worker forces a credential refresh) and fails every participant
 * once that refresh did not help; a transient failure waits for the provider's
 * retry time or the delay, inside the delivery window; anything else fails.
 */
export function planParticipantFailure(
  participantIds: string[],
  failure: {
    error: string
    transient: boolean
    requiresReauth: boolean
    forcedRefresh: boolean
    messageSentAt: Date | null
    retryAt?: Date
    delayMs?: number
  },
  now: Date = new Date(),
): ExternalParticipantSettlement {
  const failAll = (error: string): ExternalParticipantSettlement => ({ failed: participantIds.map((id) => ({ id, error })) })
  if (failure.requiresReauth) {
    return failure.forcedRefresh
      ? failAll(failure.error)
      : { retry: participantIds.map((id) => ({ id, error: failure.error, nextAttemptAt: now })) }
  }
  if (!failure.transient) return failAll(failure.error)
  const plan = planTransientRetry({ messageSentAt: failure.messageSentAt, retryAt: failure.retryAt, delayMs: failure.delayMs, now })
  if ('expired' in plan) return failAll(DELIVERY_WINDOW_EXCEEDED_ERROR)
  return { retry: participantIds.map((id) => ({ id, error: failure.error, nextAttemptAt: plan.nextAttemptAt })) }
}

registerCommand(deliverOutboundMessageCommand)

export default deliverOutboundMessageCommand
