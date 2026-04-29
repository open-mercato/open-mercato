import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  InboxOpsSourceAdapter,
  InboxOpsSourcePromptHints,
  NormalizedInboxOpsInput,
} from '@open-mercato/shared/modules/inbox-ops-sources'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Message } from './data/entities'

type LoadedMessageSource = {
  message: Message
  sender: User | null
}

function resolveEm(ctx: { resolve: <T = unknown>(name: string) => T }): EntityManager {
  return (ctx.resolve('em') as EntityManager).fork()
}

function readNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function buildSourceKind(message: Message): string {
  return message.visibility === 'public' ? 'public message' : 'internal message'
}

function buildSourceLabel(message: Message): string {
  return readNonEmptyString(message.externalEmail)
    ?? readNonEmptyString(message.externalName)
    ?? (message.visibility === 'public' ? 'Public message' : 'Internal message')
}

function buildParticipants(loaded: LoadedMessageSource): NormalizedInboxOpsInput['participants'] {
  const senderEmail = readNonEmptyString(loaded.sender?.email)
  const senderName = readNonEmptyString(loaded.sender?.name)
  const externalEmail = readNonEmptyString(loaded.message.externalEmail)
  const externalName = readNonEmptyString(loaded.message.externalName)

  const participants: NormalizedInboxOpsInput['participants'] = [
    {
      identifier: senderEmail ?? `user:${loaded.message.senderUserId}`,
      displayName: senderName,
      ...(senderEmail ? { email: senderEmail } : {}),
      role: 'sender',
    },
  ]

  if (externalEmail) {
    participants.push({
      identifier: externalEmail,
      displayName: externalName,
      email: externalEmail,
      role: 'recipient',
    })
  }

  return participants
}

function buildPromptHints(message: Message): InboxOpsSourcePromptHints {
  return {
    sourceLabel: 'message',
    sourceKind: buildSourceKind(message),
    primaryEvidence: ['title', 'body'],
    participantIdentityMode: message.visibility === 'public' ? 'email-first' : 'mixed',
    replySupport: 'none',
    extraInstructions: [
      'Treat the subject as a concise summary of the sender intent.',
      'Do not infer a reply workflow unless the message explicitly contains external recipient data.',
    ],
  }
}

const messageSourceAdapter: InboxOpsSourceAdapter<LoadedMessageSource> = {
  sourceEntityType: 'messages:message',
  displayKind: 'message',
  displayIcon: 'message-square',
  async loadSource(args, ctx) {
    const em = resolveEm(ctx)
    const scope = {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
    }

    const message = await findOneWithDecryption(
      em,
      Message,
      {
        id: args.sourceEntityId,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (!message) {
      throw new Error(`Message not found: ${args.sourceEntityId}`)
    }

    const sender = await findOneWithDecryption(
      em,
      User,
      {
        id: message.senderUserId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    return { message, sender }
  },
  getVersion(loaded) {
    return loaded.message.sentAt?.toISOString() ?? loaded.message.createdAt.toISOString()
  },
  buildInput(loaded, args) {
    return {
      sourceEntityType: args.sourceEntityType,
      sourceEntityId: loaded.message.id,
      sourceVersion: loaded.message.sentAt?.toISOString() ?? loaded.message.createdAt.toISOString(),
      title: loaded.message.subject,
      body: loaded.message.body,
      bodyFormat: loaded.message.bodyFormat,
      participants: buildParticipants(loaded),
      capabilities: {
        canDraftReply: false,
        replyChannelType: loaded.message.visibility === 'public' ? 'email' : undefined,
        canUseTimelineContext: false,
      },
      sourceMetadata: {
        visibility: loaded.message.visibility ?? null,
        externalEmail: loaded.message.externalEmail ?? null,
        externalName: loaded.message.externalName ?? null,
        sendViaEmail: loaded.message.sendViaEmail,
        messageType: loaded.message.type,
        threadId: loaded.message.threadId ?? null,
        parentMessageId: loaded.message.parentMessageId ?? null,
      },
    }
  },
  buildPromptHints(loaded) {
    return buildPromptHints(loaded.message)
  },
  buildSnapshot(loaded) {
    return {
      sourceLabel: buildSourceLabel(loaded.message),
      sourceKind: buildSourceKind(loaded.message),
      visibility: loaded.message.visibility ?? null,
      externalEmail: loaded.message.externalEmail ?? null,
      externalName: loaded.message.externalName ?? null,
      sentAt: loaded.message.sentAt?.toISOString() ?? null,
    }
  },
}

export const inboxOpsSourceAdapters: InboxOpsSourceAdapter[] = [
  messageSourceAdapter,
]
