import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'record_locks.lock.force_released',
    module: 'record_locks',
    titleKey: 'record_locks.notifications.lock_force_released.title',
    bodyKey: 'record_locks.notifications.lock_force_released.body',
    icon: 'unlock',
    severity: 'warning',
    actions: [],
    expiresAfterHours: 48,
  },
  {
    type: 'record_locks.conflict.detected',
    module: 'record_locks',
    titleKey: 'record_locks.notifications.conflict_detected.title',
    bodyKey: 'record_locks.notifications.conflict_detected.body',
    icon: 'git-compare-arrows',
    severity: 'warning',
    actions: [
      {
        id: 'accept_incoming',
        labelKey: 'record_locks.notifications.actions.accept_incoming',
        variant: 'outline',
        commandId: 'record_locks.conflict.accept_incoming',
      },
      {
        id: 'accept_mine',
        labelKey: 'record_locks.notifications.actions.accept_mine',
        variant: 'default',
        commandId: 'record_locks.conflict.accept_mine',
      },
    ],
    primaryActionId: 'accept_mine',
    expiresAfterHours: 48,
  },
  {
    type: 'record_locks.conflict.resolved',
    module: 'record_locks',
    titleKey: 'record_locks.notifications.conflict_resolved.title',
    bodyKey: 'record_locks.notifications.conflict_resolved.body',
    icon: 'check-circle',
    severity: 'info',
    actions: [],
    expiresAfterHours: 48,
  },
]

export default notificationTypes
