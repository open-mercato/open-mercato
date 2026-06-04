import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { classifyOutboundError, isReauthError } from '../lib/error-classification'
import {
  buildBodyFooter,
  buildReferencesId,
  getOrCreateThreadToken,
} from '../lib/thread-token'
import { stringOrUndefined, stripBrackets } from '../lib/email-mime'
import type { ChannelAdapterRegistry } from '../lib/registry'
import { isUniqueViolation } from '../lib/pg-errors'
import { Message } from '../../messages/data/entities'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'

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
})

export type DeliverOutboundMessageInput = z.infer<typeof deliverInputSchema>

export type DeliverOutboundMessageResult =
  | { status: 'no_channel_link' }
  | { status: 'already_delivered'; messageId: string; channelLinkId: string }
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
    }

export const COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID =
  'communication_channels.message.deliver_outbound'

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
 *   3. Idempotently upsert a 'pending' MessageChannelLink (unique on `messageId`).
 *      Skip if a 'sent'/'delivered' link already exists.
 *   4. Refresh credentials when OAuth + near expiry (or when caller forces it).
 *   5. Call `adapter.convertOutbound(...)` → channel-native content.
 *   6. Call `adapter.sendMessage(...)`.
 *   7. On success: persist ExternalMessage + flip link to 'sent', emit `.message.sent`.
 *   8. On failure: flip link to 'failed' + classify error, log to integrationLog,
 *      emit `.delivery_failed`. The worker decides whether to retry based on
 *      `result.transient`.
 *
 * Idempotency: the unique constraint on `message_channel_links.message_id`
 * prevents the same Message being sent twice through the channel even if the
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

    // (1 cont.) Look up the channel link via ChannelThreadMapping.threadId.
    const mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        messageThreadId: message.threadId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!mapping) {
      // Internal-only message — no channel delivery needed.
      return NO_THREAD_MAPPING_RESULT
    }

    // (2) Channel + adapter.
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: mapping.channelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (!channel) {
      throw new Error(
        `[internal] Channel ${mapping.channelId} not found for tenant ${input.scope.tenantId} (or has been deleted)`,
      )
    }
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

    // (3) Idempotently upsert a 'pending' MessageChannelLink.
    let link = await findOneWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: message.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (
      link &&
      (link.deliveryStatus === 'queued' ||
        link.deliveryStatus === 'sent' ||
        link.deliveryStatus === 'delivered' ||
        link.deliveryStatus === 'read')
    ) {
      // Already sent (or accepted by the provider as 'queued') — short-circuit
      // so a retried job does not re-invoke the adapter and double-send.
      return {
        status: 'already_delivered',
        messageId: message.id,
        channelLinkId: link.id,
      }
    }
    if (!link) {
      link = em.create(MessageChannelLink, {
        messageId: message.id,
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
        // reach here. The `message_channel_links_message_uq` index rejects the
        // loser with a 23505. Defer to the winning job — re-read its link on a
        // fresh fork and report `already_delivered` — instead of re-invoking the
        // adapter (double send) or letting the raw error dead-letter the job.
        if (isUniqueViolation(flushErr)) {
          const winner = await findOneWithDecryption(
            em.fork(),
            MessageChannelLink,
            {
              messageId: message.id,
              tenantId: input.scope.tenantId,
              organizationId: input.scope.organizationId ?? null,
            },
            undefined,
            dscope,
          )
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
    const credentialsScope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? input.scope.tenantId,
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
        logger: (...args) => console.warn(...args),
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
      console.warn(
        '[communication_channels:deliver-outbound] thread token unavailable, proceeding without it:',
        tokenErr instanceof Error ? tokenErr.message : tokenErr,
      )
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

      // Pre-existing channelMetadata.references (string[]) so we can extend
      // it with the synthetic thread-token id without disturbing other refs
      // (e.g. the recipient's own reply chain).
      const baseMetadata = (link.channelMetadata as Record<string, unknown> | undefined) ?? {}
      const existingRefs = Array.isArray(baseMetadata.references)
        ? (baseMetadata.references as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : []
      let mergedReferences = existingRefs
      if (threadToken && !outboundBody.includes(`[OM:${threadToken}]`)) {
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
      const converted = await adapter.convertOutbound({
        body: outboundBody,
        bodyFormat: outboundBodyFormat,
        channelMetadata: {
          thread_id: mapping.externalThreadRef,
          ...baseMetadata,
          references: mergedReferences,
          ...(threadToken ? { omThreadToken: threadToken } : {}),
        },
      })

      // NOTE — at-least-once delivery (accepted v1 semantics). This provider
      // send is a non-transactional external side effect. The terminal-status
      // short-circuit above and the `message_channel_links_message_uq` index
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
          organizationId: input.scope.organizationId ?? input.scope.tenantId,
        },
        metadata: converted.metadata,
      })

      if (sendResult.status === 'failed') {
        throw new Error(sendResult.error ?? `Adapter '${adapter.providerKey}' reported send failure`)
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

      link.deliveryStatus = sendResult.status === 'sent' ? 'sent' : 'queued'
      link.externalMessageId = externalMessageRowId
      link.channelMetadata = {
        ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        ...(converted.metadata ?? {}),
        externalMessageId: sendResult.externalMessageId,
        // Always persist the RFC2822 Message-ID so inbound reply matching (JWZ
        // strategy in lib/thread-matcher) and sent-folder dedup can resolve this
        // outbound message. Adapters that build the message themselves (Gmail)
        // return it in `converted.metadata.messageId`; IMAP/SMTP lets
        // the transport mint it, surfacing it only as `sendResult.externalMessageId`
        // (the RFC2822 id the recipient replies to) — fall back to that.
        // Store it bracket-stripped to match the inbound convention
        // (`normalizeMimeInbound` strips), so the JWZ matcher and sent-folder dedup —
        // which compare against stripped ids — resolve it. `assembleRfc2822`
        // re-applies brackets when this id is later used to build reply headers.
        messageId: stripBrackets(
          stringOrUndefined((converted.metadata as Record<string, unknown> | undefined)?.messageId) ??
            sendResult.externalMessageId,
        ),
      }
      await em.flush()

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
      link.deliveryStatus = 'failed'
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
      }
    }
  },
}

registerCommand(deliverOutboundMessageCommand)

export default deliverOutboundMessageCommand
