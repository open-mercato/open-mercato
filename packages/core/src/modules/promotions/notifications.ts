import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

// #8268 review Major 7: `reinstateCodeUse`/`reinstateUsage` (lib/code-service.ts,
// lib/promotion-usage-service.ts) deliberately refuse a reinstatement that would push a
// capped code or a budgeted promotion past its limit — correct, since the alternative is
// overflowing a hard numeric invariant — but the order being revived keeps its original
// discount with no usage counted against it anywhere. Both refusal paths already emit a
// domain event (`promotions.code.exhausted`, `promotions.promotion.budget_exhausted`); this
// is their first real consumer, so the gap stops being silent in practice, not just logged.
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'promotions.usage.reinstate_blocked',
    module: 'promotions',
    channels: ['in_app'],
    titleKey: 'promotions.notifications.usageReinstateBlocked.title',
    bodyKey: 'promotions.notifications.usageReinstateBlocked.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
