import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

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
  subject: string
  body: string
}

function resolveCommandBus(container: ResolverLike): CommandBus | null {
  try {
    const bus = container.resolve('commandBus') as CommandBus
    return bus && typeof bus.execute === 'function' ? bus : null
  } catch {
    return null
  }
}

export async function createMessageRecordForEmail(
  email: InboxEmailData,
  ctx: MessagesIntegrationContext,
): Promise<string | null> {
  try {
    const commandBus = resolveCommandBus(ctx.container)
    if (!commandBus) return null

    const bodyText = email.cleanedText || email.rawText || ''

    const { result } = await commandBus.execute('messages.messages.compose', {
      input: {
        type: 'inbox_ops.email',
        visibility: 'internal' as const,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: email.id,
        externalEmail: email.forwardedByAddress,
        externalName: email.forwardedByName || undefined,
        recipients: [],
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

    const { result } = await commandBus.execute('messages.messages.compose', {
      input: {
        type: 'inbox_ops.reply',
        visibility: 'public' as const,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: inboxEmailId,
        externalEmail: reply.to,
        recipients: [],
        subject: reply.subject,
        body: reply.body,
        bodyFormat: 'text' as const,
        priority: 'normal' as const,
        isDraft: false,
        sendViaEmail: true,
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
