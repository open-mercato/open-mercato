import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message } from '../data/entities'
import { attachmentIdsPayloadSchema, unlinkAttachmentPayloadSchema } from '../data/validators'
import { linkAttachmentsToMessage } from '../lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../lib/constants'
import { assertOrganizationAccess, getAttachmentIdsForMessage, type MessageScopeInput } from './shared'

const attachmentMutationScopeSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

const linkDraftAttachmentsSchema = attachmentMutationScopeSchema.extend({
  attachmentIds: attachmentIdsPayloadSchema.shape.attachmentIds,
})

const unlinkDraftAttachmentsSchema = attachmentMutationScopeSchema.extend({
  attachmentIds: z.array(z.string().uuid()).min(1).max(100),
})

type AttachmentState = { attachmentIds: string[] }

type LinkDraftAttachmentsInput = z.infer<typeof linkDraftAttachmentsSchema>
type UnlinkDraftAttachmentsInput = z.infer<typeof unlinkDraftAttachmentsSchema>

async function requireEditableDraftMessage(em: EntityManager, scope: MessageScopeInput, messageId: string) {
  const message = await em.findOne(Message, {
    id: messageId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!message) throw new Error('Message not found')
  assertOrganizationAccess(scope, message)
  if (message.senderUserId !== scope.userId) throw new Error('Access denied')
  if (!message.isDraft) throw new Error('Attachments can only be modified on drafts')
  return message
}

const linkDraftAttachmentsCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.attachments.link_to_draft',
  async prepare(rawInput, ctx) {
    const input = linkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireEditableDraftMessage(em, input, input.messageId)
    return {
      before: {
        attachmentIds: await getAttachmentIdsForMessage(em, message.id, {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        }),
      } satisfies AttachmentState,
    }
  },
  async execute(rawInput, ctx) {
    const input = linkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireEditableDraftMessage(em, input, input.messageId)
    await linkAttachmentsToMessage(
      em,
      input.messageId,
      input.attachmentIds,
      input.organizationId,
      input.tenantId,
    )
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = linkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return {
      attachmentIds: await getAttachmentIdsForMessage(em, input.messageId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }),
    } satisfies AttachmentState
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = linkDraftAttachmentsSchema.parse(input)
    return {
      actionLabel: 'Link message draft attachments',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as AttachmentState | undefined) ?? null,
          after: (snapshots.after as AttachmentState | undefined) ?? null,
        },
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<{ before?: AttachmentState | null }>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const messageId = logEntry?.resourceId as string | null
    const tenantId = logEntry?.tenantId as string | null
    const organizationId = (logEntry?.organizationId as string | null) ?? null
    if (!messageId || !tenantId) return
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
    await em.nativeDelete(Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: messageId,
      tenantId,
      organizationId,
      id: { $nin: before.attachmentIds.length ? before.attachmentIds : ['00000000-0000-0000-0000-000000000000'] },
    })
    if (before.attachmentIds.length > 0) {
      const attachments = await em.find(Attachment, {
        id: { $in: before.attachmentIds },
        tenantId,
        organizationId,
      })
      for (const attachment of attachments) {
        attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
        attachment.recordId = messageId
      }
    }
    await em.flush()
  },
}

const unlinkDraftAttachmentsCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.attachments.unlink_from_draft',
  async prepare(rawInput, ctx) {
    const input = unlinkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireEditableDraftMessage(em, input, input.messageId)
    return {
      before: {
        attachmentIds: await getAttachmentIdsForMessage(em, message.id, {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        }),
      } satisfies AttachmentState,
    }
  },
  async execute(rawInput, ctx) {
    const input = unlinkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireEditableDraftMessage(em, input, input.messageId)
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
    await em.nativeDelete(Attachment, {
      id: { $in: input.attachmentIds },
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: input.messageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    return { ok: true }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = unlinkDraftAttachmentsSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return {
      attachmentIds: await getAttachmentIdsForMessage(em, input.messageId, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }),
    } satisfies AttachmentState
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = unlinkDraftAttachmentsSchema.parse(input)
    return {
      actionLabel: 'Unlink message draft attachments',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as AttachmentState | undefined) ?? null,
          after: (snapshots.after as AttachmentState | undefined) ?? null,
        },
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<{ before?: AttachmentState | null }>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const messageId = logEntry?.resourceId as string | null
    const tenantId = logEntry?.tenantId as string | null
    const organizationId = (logEntry?.organizationId as string | null) ?? null
    if (!messageId || !tenantId) return
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
    await em.nativeDelete(Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: messageId,
      tenantId,
      organizationId,
      id: { $nin: before.attachmentIds.length ? before.attachmentIds : ['00000000-0000-0000-0000-000000000000'] },
    })
    if (before.attachmentIds.length > 0) {
      const attachments = await em.find(Attachment, {
        id: { $in: before.attachmentIds },
        tenantId,
        organizationId,
      })
      for (const attachment of attachments) {
        attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
        attachment.recordId = messageId
      }
    }
    await em.flush()
  },
}

export function parseUnlinkAttachmentIds(rawInput: unknown): string[] {
  const input = unlinkAttachmentPayloadSchema.parse(rawInput)
  return input.attachmentIds ?? (input.attachmentId ? [input.attachmentId] : [])
}

registerCommand(linkDraftAttachmentsCommand)
registerCommand(unlinkDraftAttachmentsCommand)
