// Release 5 Phase 4 (Step 2.6, G5/spec §9 portal table): "Holders of `…decide` see
// their company's requests; others see only requests they made." The pure half of
// that rule lives here — one function the list route turns into a `WHERE`, the same
// function the detail/decide/withdraw routes reuse for their single-row cross-company
// guard — mirroring `workflows/lib/portal-task-access.ts`'s "pure predicate, thin route
// wrapper" split so the rule is expressed exactly once.

export type PortalApprovalPrincipal = {
  tenantId: string
  organizationId: string
  customerEntityId: string
  customerUserId: string
  canDecide: boolean
}

// Shaped to match `ApprovalView.requestedBy` from
// `services/customerPurchaseApprovalService.ts` (the service's own response shape)
// directly, so the staff/portal routes can pass an `ApprovalView` here without
// reshaping it first.
export type PortalApprovalSubjectFacts = {
  customerId: string
  requestedBy: { actorType: 'customer_user' | 'staff_user'; actorId: string }
}

// §9.2: "A portal request for another company's approval answers 404 ... never 403, so
// it does not disclose that the id exists." This is the SOLE authority for that check —
// every portal route (list filter, detail, decide, withdraw) calls through here rather
// than re-deriving the comparison.
export function isApprovalVisibleToPortalPrincipal(
  principal: PortalApprovalPrincipal,
  approval: PortalApprovalSubjectFacts,
): boolean {
  if (approval.customerId !== principal.customerEntityId) return false
  if (principal.canDecide) return true
  return approval.requestedBy.actorType === 'customer_user' && approval.requestedBy.actorId === principal.customerUserId
}

// The expressible half as ORM conditions for the portal list route. Always scoped to
// the caller's own company (`customerId`); additionally narrowed to the caller's own
// requests when they do not hold `customer_groups.portal.approvals.decide`.
export function buildPortalApprovalListWhere(principal: PortalApprovalPrincipal): Record<string, unknown> {
  const where: Record<string, unknown> = {
    tenantId: principal.tenantId,
    organizationId: principal.organizationId,
    customerId: principal.customerEntityId,
  }
  if (!principal.canDecide) {
    where.requestedByActorType = 'customer_user'
    where.requestedByActorId = principal.customerUserId
  }
  return where
}
