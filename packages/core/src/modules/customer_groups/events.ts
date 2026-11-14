import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'customer_groups.group.created', label: 'Customer Group Created', entity: 'group', category: 'crud' },
  { id: 'customer_groups.group.updated', label: 'Customer Group Updated', entity: 'group', category: 'crud' },
  { id: 'customer_groups.group.deleted', label: 'Customer Group Deleted', entity: 'group', category: 'crud' },
  { id: 'customer_groups.membership.added', label: 'Customer Added to Group', entity: 'membership', category: 'crud' },
  { id: 'customer_groups.membership.removed', label: 'Customer Removed from Group', entity: 'membership', category: 'crud' },
  { id: 'customer_groups.membership.expired', label: 'Group Membership Expired', entity: 'membership', category: 'lifecycle' },
  { id: 'customer_groups.terms.updated', label: 'Customer Group Terms Updated', entity: 'terms', category: 'crud' },
  // Release 5 Phase 3 (G15/G18, D-R5-2, §10). Emitted by `reserveCredit` on a refusal
  // whose reason is `limit_exceeded`, after the (no-op) writing transaction commits. Drives
  // the `customer_groups.credit.limit_exceeded` notification (`notifications.ts`) through a
  // persistent subscriber. The remaining `credit.*`/`credit_account.*` events in spec §10
  // (reserved/released/settled/put_on_hold/released_from_hold) still have no consumer and
  // stay undeclared — see NOTIFY.md.
  { id: 'customer_groups.credit.limit_exceeded', label: 'Credit Limit Exceeded', entity: 'credit_account', category: 'lifecycle' },
  // Step 1.12 (G18, D-R5-2, §10.1 `CreditEntryEventPayload`). Emitted by `adjustCredit`
  // after a genuinely new `adjust` ledger entry commits (never on an idempotent replay) —
  // the `/adjust` command's own forward write and its undo (the inverse entry) both go
  // through this one emission path.
  { id: 'customer_groups.credit.adjusted', label: 'Credit Adjustment Posted', entity: 'credit_account', category: 'lifecycle' },
  // Release 5 Phase 4 (G3/G6/G9/G18, D-R5-1/D-R5-6/D-R5-32, §10/§10.1/§6.6). State
  // signals `customerPurchaseApprovalService` emits after every CAS transition commits
  // (no event for a mid-way slot decision that leaves the overall status `pending`, §6.6).
  // `portalBroadcast: true` on every one of the five (D-R5-6/§10.1: "available to a
  // portal client of the approval's company") — `customer_groups` is the ONLY module that
  // notifies about approvals (D-R5-32); `cart`/`checkout` subscribe to these same five ids
  // persistently and idempotently to resume or clear their own subject, never the other
  // way around (§4.2 holds: this module imports neither). In-app/e-mail notification
  // wiring that REACTS to `.requested`/`.approved`/`.rejected`/`.expired` is Step 2.7's
  // scope — this Step only declares and emits the signals.
  { id: 'customer_groups.approval.requested', label: 'Purchase Approval Requested', entity: 'approval', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_groups.approval.approved', label: 'Purchase Approval Approved', entity: 'approval', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_groups.approval.rejected', label: 'Purchase Approval Rejected', entity: 'approval', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_groups.approval.expired', label: 'Purchase Approval Expired', entity: 'approval', category: 'lifecycle', portalBroadcast: true },
  { id: 'customer_groups.approval.withdrawn', label: 'Purchase Approval Withdrawn', entity: 'approval', category: 'lifecycle', portalBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'customer_groups',
  events,
})

export const emitCustomerGroupsEvent = eventsConfig.emit

export type CustomerGroupsEventId = typeof events[number]['id']

export default eventsConfig
