import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

// Release 5 Phase 3 (Step 2.2, §9). Only the commit-recovery notification is declared here:
// `commitAvailability` raises it when the expiry sweep wins the CAS race against a payment
// that already created the order, and the one fresh re-reserve attempt still finds the
// stock gone (`reason: 'stock_lost_after_payment'`) — "never fail silently" per §4.1. Sent
// to staff of the organization holding `availability.policies.manage` (no dedicated
// `availability.reservations.*` feature exists — the admin reservations list is outside
// Release 5, A18/D-R5-34).
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'availability.stock_lost_after_payment',
    module: 'availability',
    channels: ['in_app'],
    titleKey: 'availability.notifications.stockLostAfterPayment.title',
    bodyKey: 'availability.notifications.stockLostAfterPayment.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [],
    expiresAfterHours: 168,
  },
]

export default notificationTypes
