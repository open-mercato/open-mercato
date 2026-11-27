import type { EntityManager } from '@mikro-orm/postgresql'

export const MESSAGE_COMPOSER_UPLOAD_PREFIX = 'messages-composer:'
export const MAILBOX_ATTACHMENT_COUNT_LIMIT = 10

export function isMessageComposerUploadRecordId(recordId: unknown): recordId is string {
  return typeof recordId === 'string' && recordId.length <= 200
    && recordId.startsWith(MESSAGE_COMPOSER_UPLOAD_PREFIX)
    && /^[a-z0-9-]+$/i.test(recordId.slice(MESSAGE_COMPOSER_UPLOAD_PREFIX.length))
}

export type MailboxComposePayload = {
  messageType?: string
  objects?: Array<{
    entityModule: string
    entityType: string
    entityId: string
    actionRequired?: boolean
    actionType?: string
    actionLabel?: string
  }>
  uploads?: { recordId: string; attachmentIds?: string[] }
}
export type MailboxComposeTransaction = {
  persistMailboxDelivery?: (
    em: EntityManager,
    message: { messageId: string; threadId: string },
  ) => Promise<void>
}
