import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getRecipientUserIdsForFeature } from '../../notifications/lib/notificationRecipients'

interface ResolverLike {
  resolve: <T = unknown>(name: string) => T
}

function asContainer(resolver: ResolverLike): AwilixContainer {
  return resolver as unknown as AwilixContainer
}

interface MessagesIntegrationScope {
  tenantId: string
  organizationId: string
  userId: string
}

interface MessagesIntegrationContext {
  container: ResolverLike
  scope: MessagesIntegrationScope
}

interface InboxEmailData {
  id: string
  subject: string
  cleanedText?: string | null
  rawText?: string | null
  forwardedByAddress: string
  forwardedByName?: string | null
  status: string
}

interface DraftReplyData {
  to: string
  toName?: string | null
  subject: string
  body: string
}

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Resolve a real user ID to use as the message sender.
 * Tries to find the forwarding user by email in the auth users table,
 * then falls back to the first recipient (admin with proposals.view).
 * Last resort: SYSTEM_USER_ID (zero UUID).
 */
export async function resolveMessageSenderUserId(
  em: EntityManager,
  forwardedByEmail: string,
  recipientUserIds: string[],
  scope: { tenantId: string; organizationId: string },
): Promise<string> {
  try {
    // Direct knex: users.email is a plaintext login field, not encrypted at
    // field level, so findOneWithDecryption is unnecessary here.
    const knex = em.getKnex()
    const normalizedEmail = forwardedByEmail.trim().toLowerCase()
    if (normalizedEmail) {
      const row = await knex('users')
        .select('id')
        .where('email', normalizedEmail)
        .whereNull('deleted_at')
        .first()
      if (row?.id) return row.id
    }
  } catch {
    // User lookup failed — fall through
  }
  if (recipientUserIds.length > 0) return recipientUserIds[0]
  return SYSTEM_USER_ID
}

function resolveCommandBus(container: ResolverLike): CommandBus | null {
  try {
    const bus = container.resolve('commandBus') as CommandBus
    return bus && typeof bus.execute === 'function' ? bus : null
  } catch {
    return null
  }
}

/**
 * Creates an internal message record for an incoming inbox email.
 *
 * The message is delivered to all users with the `inbox_ops.proposals.view`
 * feature in the tenant — mirroring the same audience that sees proposals
 * in the inbox_ops module. This follows the shared-queue pattern used by
 * all major ERP/CRM systems (Salesforce queues, Dynamics 365 queues,
 * HubSpot shared inboxes, Odoo team followers).
 */
export async function createMessageRecordForEmail(
  email: InboxEmailData,
  ctx: MessagesIntegrationContext,
): Promise<string | null> {
  try {
    const commandBus = resolveCommandBus(ctx.container)
    if (!commandBus) return null

    const em = ctx.container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const recipientUserIds = await getRecipientUserIdsForFeature(
      knex, ctx.scope.tenantId, 'inbox_ops.proposals.view',
    )

    const recipients = recipientUserIds.map((userId) => ({ userId, type: 'to' as const }))
    // Use rawText (full thread) instead of cleanedText (stripped quotes) so
    // the Messages module preserves the complete email conversation.
    const bodyText = email.rawText || email.cleanedText || ''

    // Resolve a real user as sender — prefer the forwarding user, fall back
    // to the first recipient (admin with proposals.view feature) so the
    // Messages UI can display an actual user name instead of the zero UUID.
    const senderUserId = await resolveMessageSenderUserId(
      em, email.forwardedByAddress, recipientUserIds, ctx.scope,
    )

    const { result } = await commandBus.execute('messages.messages.compose', {
      input: {
        type: 'inbox_ops.email',
        visibility: recipients.length > 0 ? 'internal' as const : 'public' as const,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: email.id,
        externalEmail: email.forwardedByAddress,
        externalName: email.forwardedByName || undefined,
        recipients,
        subject: email.subject,
        body: bodyText.slice(0, 50000),
        bodyFormat: 'text' as const,
        priority: 'normal' as const,
        isDraft: false,
        sendViaEmail: false,
        objects: [
          {
            entityModule: 'inbox_ops',
            entityType: 'inbox_email',
            entityId: email.id,
            actionRequired: false,
          },
        ],
        tenantId: ctx.scope.tenantId,
        organizationId: ctx.scope.organizationId,
        userId: senderUserId,
      },
      ctx: {
        container: asContainer(ctx.container),
        auth: null,
        organizationScope: null,
        selectedOrganizationId: ctx.scope.organizationId,
        organizationIds: [ctx.scope.organizationId],
      },
    })

    const messageId = (result as { id: string })?.id ?? null
    return messageId
  } catch (err) {
    console.error(
      '[inbox_ops:messages] Failed to create message record for email:',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

export async function createMessageRecordForReply(
  reply: DraftReplyData,
  inboxEmailId: string,
  ctx: MessagesIntegrationContext,
): Promise<{ messageId: string } | null> {
  try {
    const commandBus = resolveCommandBus(ctx.container)
    if (!commandBus) return null

    const em = ctx.container.resolve('em') as EntityManager
    const knex = em.getKnex()
    const recipientUserIds = await getRecipientUserIdsForFeature(
      knex, ctx.scope.tenantId, 'inbox_ops.proposals.view',
    )
    if (recipientUserIds.length === 0) return null

    const recipients = recipientUserIds.map((userId) => ({ userId, type: 'to' as const }))

    const { result } = await commandBus.execute('messages.messages.compose', {
      input: {
        type: 'inbox_ops.reply',
        visibility: 'internal' as const,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: inboxEmailId,
        externalEmail: reply.to,
        externalName: reply.toName ?? undefined,
        recipients,
        subject: reply.subject,
        body: reply.body,
        bodyFormat: 'text' as const,
        priority: 'normal' as const,
        isDraft: false,
        sendViaEmail: false,
        objects: [
          {
            entityModule: 'inbox_ops',
            entityType: 'inbox_email',
            entityId: inboxEmailId,
            actionRequired: false,
          },
        ],
        tenantId: ctx.scope.tenantId,
        organizationId: ctx.scope.organizationId,
        userId: ctx.scope.userId,
      },
      ctx: {
        container: asContainer(ctx.container),
        auth: null,
        organizationScope: null,
        selectedOrganizationId: ctx.scope.organizationId,
        organizationIds: [ctx.scope.organizationId],
      },
    })

    const messageId = (result as { id: string })?.id ?? null
    if (!messageId) return null
    return { messageId }
  } catch (err) {
    console.error(
      '[inbox_ops:messages] Failed to create reply message record:',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}
