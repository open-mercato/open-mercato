import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  // --- Phase 5 push smoke-test fixtures (demo only) ---------------------------
  {
    type: 'demo.silent_ping',
    module: 'example',
    titleKey: 'example.notifications.demoSilentPing.title',
    bodyKey: 'example.notifications.demoSilentPing.body',
    icon: 'bell',
    severity: 'info',
    category: 'demo',
    actions: [],
    // Delivered as a silent / content-available data-only wake-up (no visible alert).
    silent: true,
  },
  {
    type: 'demo.push_playground',
    module: 'example',
    titleKey: 'example.notifications.demoPushPlayground.title',
    bodyKey: 'example.notifications.demoPushPlayground.body',
    icon: 'bell',
    severity: 'info',
    category: 'demo',
    actions: [],
  },
  {
    type: 'example.umes.actionable',
    module: 'example',
    titleKey: 'example.notifications.umesActionable.title',
    bodyKey: 'example.notifications.umesActionable.body',
    icon: 'bell',
    severity: 'info',
    actions: [
      {
        id: 'open',
        labelKey: 'common.open',
        variant: 'outline',
        href: '/backend/umes-next-phases?allowed=1',
        icon: 'external-link',
      },
      {
        id: 'dismiss',
        labelKey: 'notifications.actions.dismiss',
        variant: 'ghost',
      },
    ],
    primaryActionId: 'open',
    linkHref: '/backend/umes-next-phases?allowed=1',
    expiresAfterHours: 24,
  },
]

export default notificationTypes
