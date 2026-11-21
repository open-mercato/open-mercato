import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResult,
  SearchResultPresenter,
  SearchResultVisibilityContext,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('messages').child({ component: 'search' })
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

function isContainerLike(value: unknown): value is ContainerLike {
  return typeof value === 'object' && value !== null && typeof (value as { resolve?: unknown }).resolve === 'function'
}

function isOrganizationVisible(ctx: SearchResultVisibilityContext, organizationId: string | null): boolean {
  if (ctx.organizationId) return organizationId === ctx.organizationId
  if (Array.isArray(ctx.organizationIds)) return organizationId !== null && ctx.organizationIds.includes(organizationId)
  return true
}

function resolveParticipantUserId(auth: SearchResultVisibilityContext['viewer']['auth']): string | null {
  if (auth.isApiKey === true) return null
  if (typeof auth.keyId === 'string' && auth.keyId.length > 0) return null
  if (typeof auth.sub === 'string' && auth.sub.startsWith('api_key:')) return null
  const candidate = typeof auth.userId === 'string' && auth.userId.length > 0 ? auth.userId : auth.sub
  return typeof candidate === 'string' && UUID_PATTERN.test(candidate) ? candidate : null
}

/**
 * Keep only message search hits the viewer may read via `GET /api/messages/[id]`:
 * the sender, a non-deleted recipient (for non-draft messages), or a caller granted
 * channel-thread access for an explicitly `public`, non-draft channel message.
 * API-key callers and non-UUID subjects receive no hits (fail closed).
 */
export async function filterVisibleMessages(ctx: SearchResultVisibilityContext): Promise<SearchResult[]> {
  const container = ctx.viewer.container
  if (!isContainerLike(container)) {
    throw new Error('[internal] Message visibility check requires a request container')
  }
  const auth = ctx.viewer.auth
  if (auth.isSuperAdmin !== true && auth.tenantId !== ctx.tenantId) return []
  if (!ctx.organizationId && Array.isArray(ctx.organizationIds) && ctx.organizationIds.length === 0) return []

  const userId = resolveParticipantUserId(auth)
  if (!userId) return []

  const messageIds = Array.from(
    new Set(ctx.results.map((result) => result.recordId).filter((id) => UUID_PATTERN.test(id))),
  )
  if (!messageIds.length) return []

  const [
    { Message, MessageRecipient },
    { canUseChannelThreadFallback },
    {
      EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
      resolveActorFeatures,
      resolveMessageChannelThreadAccess,
    },
  ] = await Promise.all([
    import('./data/entities'),
    import('./lib/routeHelpers'),
    import('./lib/channelThreadAccess'),
  ])

  const em = container.resolve<EntityManager>('em')
  const decryptionScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId ?? null }
  const messages = await findWithDecryption(
    em,
    Message,
    { id: { $in: messageIds }, tenantId: ctx.tenantId, deletedAt: null },
    {
      fields: [
        'id',
        'tenantId',
        'organizationId',
        'senderUserId',
        'isDraft',
        'visibility',
        'threadId',
        'sourceEntityType',
      ],
    },
    decryptionScope,
  )

  const scopedMessages = messages.filter(
    (message) => message.tenantId === ctx.tenantId && isOrganizationVisible(ctx, message.organizationId ?? null),
  )
  if (!scopedMessages.length) return []

  const nonSenderNonDraftIds = scopedMessages
    .filter((message) => message.senderUserId !== userId && message.isDraft !== true)
    .map((message) => message.id)

  const recipientRows = nonSenderNonDraftIds.length > 0
    ? await findWithDecryption(
        em,
        MessageRecipient,
        {
          messageId: { $in: nonSenderNonDraftIds },
          recipientUserId: userId,
          deletedAt: null,
        },
        { fields: ['messageId'] },
        decryptionScope,
      )
    : []
  const recipientMessageIds = new Set(recipientRows.map((row) => row.messageId))

  const visibleIds = new Set<string>()
  const channelCandidates: Array<{ id: string; organizationId: string | null; threadId: string }> = []

  for (const message of scopedMessages) {
    if (message.senderUserId === userId) {
      visibleIds.add(message.id)
      continue
    }
    if (message.isDraft === true) continue
    if (recipientMessageIds.has(message.id)) {
      visibleIds.add(message.id)
      continue
    }
    if (
      message.visibility !== 'public'
      || message.sourceEntityType !== EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE
    ) {
      continue
    }
    channelCandidates.push({
      id: message.id,
      organizationId: message.organizationId ?? null,
      threadId: message.threadId ?? message.id,
    })
  }

  if (channelCandidates.length > 0) {
    const actorFeatures = resolveActorFeatures(auth)
    const distinctOrgs = Array.from(
      new Map(channelCandidates.map((candidate) => [candidate.organizationId ?? '__null__', candidate.organizationId])).entries(),
    )
    const fallbackEntries = await Promise.all(
      distinctOrgs.map(async ([key, organizationId]) => {
        const allowed = await canUseChannelThreadFallback(
          { container },
          { tenantId: ctx.tenantId, organizationId, userId },
        )
        return [key, allowed] as const
      }),
    )
    const allowedOrgKeys = new Set(
      fallbackEntries.filter(([, allowed]) => allowed).map(([key]) => key),
    )

    const eligibleCandidates = channelCandidates.filter((candidate) =>
      allowedOrgKeys.has(candidate.organizationId ?? '__null__'),
    )
    const distinctThreads = Array.from(
      new Map(
        eligibleCandidates.map((candidate) => [
          `${candidate.organizationId ?? '__null__'}:${candidate.threadId}`,
          candidate,
        ]),
      ).entries(),
    )

    const allowedThreadKeys = new Set<string>()
    const THREAD_CONCURRENCY = 10
    for (let index = 0; index < distinctThreads.length; index += THREAD_CONCURRENCY) {
      const batch = distinctThreads.slice(index, index + THREAD_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(async ([key, candidate]) => {
          try {
            const access = await resolveMessageChannelThreadAccess(
              container,
              { tenantId: ctx.tenantId, organizationId: candidate.organizationId },
              { messageThreadId: candidate.threadId },
              { userId, features: actorFeatures },
            )
            return [key, access?.canAccess === true] as const
          } catch (error) {
            logger.warn('Channel thread visibility lookup failed; denying channel fallback for thread', {
              threadId: candidate.threadId,
              error: error instanceof Error ? error.message : String(error),
            })
            getTelemetryRuntime()?.reportError(
              error instanceof Error ? error : new Error('[internal] Channel thread visibility lookup failed'),
              {
                module: 'messages',
                code: 'messages.search_channel_thread_visibility_failed',
                attributes: { threadId: candidate.threadId },
              },
            )
            return [key, false] as const
          }
        }),
      )
      for (const [key, allowed] of batchResults) {
        if (allowed) allowedThreadKeys.add(key)
      }
    }

    for (const candidate of eligibleCandidates) {
      if (allowedThreadKeys.has(`${candidate.organizationId ?? '__null__'}:${candidate.threadId}`)) {
        visibleIds.add(candidate.id)
      }
    }
  }

  return ctx.results.filter((result) => visibleIds.has(result.recordId))
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function buildMessagePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title = pickString(record.subject) ?? translate('messages.search.fallback.title', 'Message')
  const body = snippet(record.body)
  const externalName = pickString(record.external_name, record.externalName)
  const subtitle = [externalName, body].filter(Boolean).join(' · ') || undefined
  return {
    title: String(title),
    subtitle,
    icon: 'mail',
    badge: translate('messages.search.badge.message', 'Message'),
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'messages:message',
      aclFeatures: ['messages.view'],
      enabled: true,
      priority: 5,
      filterResults: filterVisibleMessages,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Subject', record.subject)
        appendLine(lines, 'Body', record.body)
        appendLine(lines, 'From name', record.external_name ?? record.externalName)
        if (!lines.length) return null
        return {
          text: lines,
          presenter: buildMessagePresenter(t, record),
          checksumSource: {
            record: {
              subject: record.subject,
              body: record.body,
              external_name: record.external_name ?? record.externalName,
              external_email_hash: record.external_email_hash ?? record.externalEmailHash,
            },
          },
        }
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildMessagePresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const id = pickString(ctx.record.id)
        return id ? `/backend/messages/${encodeURIComponent(id)}` : null
      },
      fieldPolicy: {
        searchable: ['subject', 'body', 'external_name'],
        hashOnly: ['external_email'],
        excluded: ['action_data', 'action_result'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
