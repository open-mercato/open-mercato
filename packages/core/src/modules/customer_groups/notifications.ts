import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

// Release 5 Phase 3 (G15, Step 1.8) + Phase 4 (G15, Step 2.7). In-app types only —
// buyer-side approval notifications go by e-mail (`lib/approvalEmails.ts`), never
// in-app, since in-app notifications reach `recipient_user_id` (a staff `User`) and
// buyer-side deciders/requesters are `CustomerUser`s with no in-app channel (spec
// §10.2). Per spec §10.2's own closing line, `customer_groups.approval.decided` is
// NOT declared in Release 5: it would only ever fire for a staff requester, and no
// Release 5 path creates one (X7) — `customerPurchaseApprovalService.requestApproval`
// only ever sets `requestedByActorType: 'customer_user'` today (the staff-authored
// proposal seam that could change this is assisted-selling Phase 1, out of this run's
// scope). See PLAN.md "Decisions taken without the owner".
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'customer_groups.credit.limit_exceeded',
    module: 'customer_groups',
    channels: ['in_app'],
    titleKey: 'customer_groups.notifications.creditLimitExceeded.title',
    bodyKey: 'customer_groups.notifications.creditLimitExceeded.body',
    icon: 'alert-triangle',
    severity: 'warning',
    // No static action: the deep link depends on whether the credit account's
    // customer resolves to a company or a person page (G11), so it is computed per
    // notification and passed as `linkHref` by the subscriber instead of a static
    // `{sourceEntityId}`-templated action href (only one path prefix is possible there).
    actions: [],
    expiresAfterHours: 168,
  },
  {
    type: 'customer_groups.approval.requested',
    module: 'customer_groups',
    channels: ['in_app'],
    titleKey: 'customer_groups.notifications.approvalRequested.title',
    bodyKey: 'customer_groups.notifications.approvalRequested.body',
    icon: 'clipboard-check',
    severity: 'info',
    // No static/linked action: no staff admin UI page for purchase approvals exists
    // yet (Step 2.6 shipped API routes only) — a future Step building that UI should
    // add one, same restraint `customer_groups.credit.limit_exceeded` took for its own
    // ambiguous deep link.
    actions: [],
    expiresAfterHours: 336,
  },
]

export default notificationTypes
