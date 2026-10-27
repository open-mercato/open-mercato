/**
 * EP-50. The customer-portal contract for time reports, in one place so the list
 * route, the detail route and the tests cannot drift from each other.
 *
 * `portal.*` is the customer RBAC namespace (`CustomerRbacService`), disjoint from
 * the staff `staff.timesheets.*` namespace. It is granted through
 * `setup.defaultCustomerRoleFeatures`, not `acl.ts` — `acl.ts` declares staff
 * features only.
 */

export const PORTAL_TIME_REPORTS_VIEW_FEATURE = 'portal.time_reports.view'

/**
 * The four predicates every portal read of `staff_time_reports` must carry, as a
 * SQL fragment with its parameters in order. Written once because a portal report
 * read that forgets one of them is a cross-customer disclosure, and three call
 * sites re-typing the same WHERE clause is how one of them eventually forgets.
 */
export function portalOwnedReportClause(scope: {
  tenantId: string
  organizationId: string
  customerId: string
}): { sql: string; params: string[] } {
  return {
    sql: `tenant_id = ? AND organization_id = ? AND customer_id = ? AND status = 'closed' AND deleted_at IS NULL`,
    params: [scope.tenantId, scope.organizationId, scope.customerId],
  }
}

export const PORTAL_TIME_REPORT_BEFORE_SPOT_ID = 'portal:staff.time_report:before'
export const PORTAL_TIME_REPORT_AFTER_SPOT_ID = 'portal:staff.time_report:after'
