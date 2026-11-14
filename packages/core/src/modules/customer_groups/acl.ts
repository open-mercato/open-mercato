export const features = [
  { id: 'customer_groups.groups.view', title: 'View customer groups', module: 'customer_groups' },
  { id: 'customer_groups.groups.manage', title: 'Manage customer groups', module: 'customer_groups', dependsOn: ['customer_groups.groups.view'] },
  { id: 'customer_groups.memberships.view', title: 'View group memberships', module: 'customer_groups' },
  { id: 'customer_groups.memberships.manage', title: 'Manage group memberships', module: 'customer_groups', dependsOn: ['customer_groups.memberships.view'] },
  { id: 'customer_groups.terms.view', title: 'View commercial terms', module: 'customer_groups' },
  { id: 'customer_groups.terms.manage', title: 'Manage commercial terms', module: 'customer_groups', dependsOn: ['customer_groups.terms.view'] },
  // Release 5 Phase 3 (G16, spec §9.1). `credit.manage` (the limit/hold edit route this
  // Step ships) and `credit.adjust` (the ledger `/adjust` command — not shipped until a
  // later Step) are separate on purpose: different kinds of financial authority tenants
  // will want to grant to different roles. Both depend on `credit.view` only, not on each
  // other.
  { id: 'customer_groups.credit.view', title: 'View credit accounts', module: 'customer_groups' },
  { id: 'customer_groups.credit.manage', title: 'Manage credit limits', module: 'customer_groups', dependsOn: ['customer_groups.credit.view'] },
  { id: 'customer_groups.credit.adjust', title: 'Post credit adjustments', module: 'customer_groups', dependsOn: ['customer_groups.credit.view'] },
  // Release 5 Phase 4 (Step 2.6, G5/G16, spec §9.1). Staff-side purchase-approval
  // features — the sibling of `credit.view`/`credit.manage` above, now that
  // `CustomerPurchaseApproval` exists (Step 2.4) and its service (Step 2.5) is wired.
  // `approvals.decide` depends on `approvals.view` only, same convention as `credit.*`.
  { id: 'customer_groups.approvals.view', title: 'View purchase approvals', module: 'customer_groups' },
  { id: 'customer_groups.approvals.decide', title: 'Decide purchase approvals', module: 'customer_groups', dependsOn: ['customer_groups.approvals.view'] },
  // Portal features (customer RBAC, granted through `defaultCustomerRoleFeatures` in
  // `setup.ts`, D-R5-7) — the buyer-facing half of G5's approval API. Resolved by
  // `CustomerRbacService`, a disjoint namespace from the staff features above.
  { id: 'customer_groups.portal.approvals.view', title: 'View purchase approvals (portal)', module: 'customer_groups' },
  {
    id: 'customer_groups.portal.approvals.decide',
    title: 'Decide purchase approvals (portal)',
    module: 'customer_groups',
    dependsOn: ['customer_groups.portal.approvals.view'],
  },
]

export default features
