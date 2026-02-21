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
    actions: [],
    expiresAfterHours: 48,
  },
  {
    type: 'record_locks.incoming_changes.available',
    module: 'record_locks',
    titleKey: 'record_locks.notifications.incoming_changes.title',
    bodyKey: 'record_locks.notifications.incoming_changes.body',
    icon: 'git-pull-request-arrow',
    severity: 'info',
    actions: [
      {
        id: 'see_incoming_changes',
        labelKey: 'record_locks.notifications.actions.see_incoming_changes',
        variant: 'default',
      },
    ],
    primaryActionId: 'see_incoming_changes',
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
