/**
 * The context keys the order-approval widget seeds when it starts the
 * `sales.order-approval` workflow. The workflow definition interpolates
 * `{{context.<key>}}` against exactly this set, and `interpolateVariables()`
 * silently returns the original string when a key is missing — so the two must
 * not drift. Both the widget and the contract test import this list, which is
 * what makes the drift a type error rather than a runtime surprise (issue #4334).
 */
export const ORDER_APPROVAL_CONTEXT_KEYS = [
  'orderId',
  'pendingApprovalStatusId',
  'approvedStatusId',
  'rejectedStatusId',
] as const

export type OrderApprovalContextKey = (typeof ORDER_APPROVAL_CONTEXT_KEYS)[number]

export type OrderApprovalInitialContext = Record<OrderApprovalContextKey, string>
