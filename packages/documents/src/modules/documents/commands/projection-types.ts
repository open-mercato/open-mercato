import type { EventPayload } from '@open-mercato/shared/modules/events'

export type DocumentsProjectedEventId =
  | 'documents.document.updated'
  | 'documents.document.archived'
  | 'documents.document.duplicated'
  | 'documents.document.unarchived'
  | 'documents.document.shared'
  | 'documents.document.unshared'
  | 'documents.comment.created'
  | 'documents.comment.mentioned'
  | 'documents.comment.resolved'
  | 'documents.version.restored'

export type DocumentsProjectionDescriptor =
  | {
      kind: 'event'
      eventId: DocumentsProjectedEventId
      tenantId: string
      organizationId: string
      payload: EventPayload
    }
  | {
      kind: 'mention-notification'
      recipientUserId: string
      tenantId: string
      organizationId: string
      documentId: string
      documentTitle: string
      commentId: string
      authorUserId: string
    }
  | {
      kind: 'watch-notification'
      recipientUserId: string
      tenantId: string
      organizationId: string
      documentId: string
      documentTitle: string
      notificationType: 'documents.watch.commented' | 'documents.watch.changed'
      bodyKey: string
      sourceEntityType: string
      sourceEntityId: string
      linkHref: string
    }
  | {
      kind: 'watch-notification-fanout'
      tenantId: string
      organizationId: string
      documentId: string
      actorUserId: string
      notificationType: 'documents.watch.commented' | 'documents.watch.changed'
      bodyKey: string
      sourceEntityType: string
      sourceEntityId: string
      linkHref: string
    }
  | {
      kind: 'document-index'
      documentId: string
      tenantId: string
      organizationId: string
    }
  | {
      kind: 'mention-notification-delete'
      commentId: string
      tenantId: string
      organizationId: string
    }

export type DocumentsProjectedCommandResult = {
  projections?: DocumentsProjectionDescriptor[]
}

export type DocumentsProjectionUndoPayload = {
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}
