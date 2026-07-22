import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'eudr.statement.submitted',
    module: 'eudr',
    titleKey: 'eudr.notifications.statement.submitted.title',
    bodyKey: 'eudr.notifications.statement.submitted.body',
    icon: 'file-check',
    severity: 'info',
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'eudr.statement.reference_issued',
    module: 'eudr',
    titleKey: 'eudr.notifications.statement.referenceIssued.title',
    bodyKey: 'eudr.notifications.statement.referenceIssued.body',
    icon: 'badge-check',
    severity: 'success',
    actions: [],
    expiresAfterHours: 720,
  },
  {
    type: 'eudr.statement.withdrawn',
    module: 'eudr',
    titleKey: 'eudr.notifications.statement.withdrawn.title',
    bodyKey: 'eudr.notifications.statement.withdrawn.body',
    icon: 'undo',
    severity: 'warning',
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'eudr.risk.non_negligible',
    module: 'eudr',
    titleKey: 'eudr.notifications.risk.nonNegligible.title',
    bodyKey: 'eudr.notifications.risk.nonNegligible.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'eudr.mitigation.completed',
    module: 'eudr',
    titleKey: 'eudr.notifications.mitigation.completed.title',
    bodyKey: 'eudr.notifications.mitigation.completed.body',
    icon: 'check-circle',
    severity: 'success',
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
