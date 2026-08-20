import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'documents.comment.mentioned',
    module: 'documents',
    titleKey: 'documents.notifications.comment.mentioned.title',
    bodyKey: 'documents.notifications.comment.mentioned.body',
    icon: 'at-sign',
    severity: 'info',
    // sourceEntityId stores the comment id, so no {sourceEntityId} href template
    // can resolve to the document URL; creation always passes an explicit
    // document-scoped linkHref (see commands/interceptors.ts).
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'documents.watch.commented',
    module: 'documents',
    titleKey: 'documents.notifications.watch.commented.title',
    bodyKey: 'documents.notifications.watch.commented.body',
    icon: 'bell',
    severity: 'info',
    // sourceEntityId stores the comment id, so no {sourceEntityId} href template
    // can resolve to the document URL; creation always passes an explicit
    // document-scoped linkHref (see commands/interceptors.ts).
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'documents.watch.changed',
    module: 'documents',
    titleKey: 'documents.notifications.watch.changed.title',
    bodyKey: 'documents.notifications.watch.changed.body',
    icon: 'bell',
    severity: 'info',
    // sourceEntityId stores the changed resource id, so no {sourceEntityId}
    // href template can resolve to the document URL; creation always passes
    // an explicit document-scoped linkHref (see commands/interceptors.ts).
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
