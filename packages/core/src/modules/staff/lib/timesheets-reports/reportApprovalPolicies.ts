/**
 * EP-41 — the report approval / lock policy provider.
 *
 * The policy layer sits ON TOP of the ACL check, it does not replace it. The
 * close and unlock routes still require `staff.timesheets.lock` and
 * `staff.timesheets.reports.unlock` respectively, unconditionally and before
 * anything here runs; a policy can only add a reason to refuse. That is enforced
 * structurally: `canClose` / `canUnlock` return a refusal or nothing, never a
 * grant, so there is no shape in which a policy can open a door the ACL closed.
 *
 * The built-in `staff.time_tracking.report_approval.acl_only` refuses nothing,
 * which is exactly the ACL-only gate the module shipped with.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from '../time-tracking/registries/registry'
import { hasResolverScope, type ScopedResolverContext } from '../time-tracking/registries/scope'

export type ReportApprovalContext = ScopedResolverContext & {
  reportId: string
  actorUserId: string | null
  /** The features the ACL gate already resolved for the actor. */
  actorFeatures: readonly string[]
  status: string
  reason?: string | null
}

export type ReportApprovalRefusal = {
  /** Machine-readable, surfaced in the response body as `code`. */
  code: string
  /** i18n key the route translates; never a user-facing literal. */
  messageKey: string
}

/** `null` — and `undefined` — mean "no objection", never "allowed". */
export type ReportApprovalVerdict = ReportApprovalRefusal | null | undefined

export type ReportApprovalPolicy = {
  id: string
  priority?: number
  canClose?(ctx: ReportApprovalContext): ReportApprovalVerdict
  canUnlock?(ctx: ReportApprovalContext): ReportApprovalVerdict
  onClosed?(ctx: ReportApprovalContext): void | Promise<void>
}

export const REPORT_APPROVAL_POLICY_REGISTRY_ID = extensionPoints.hosts.reportApprovalPolicyRegistry.spotId

export const BUILT_IN_REPORT_APPROVAL_POLICY_ID = 'staff.time_tracking.report_approval.acl_only'

const registry = createStrategyRegistry<ReportApprovalPolicy>(REPORT_APPROVAL_POLICY_REGISTRY_ID)

export function registerReportApprovalPolicy(policy: ReportApprovalPolicy): () => void {
  return registry.register(policy)
}

export function listReportApprovalPolicies(): ReportApprovalPolicy[] {
  return registry.list()
}

export function getReportApprovalPolicy(id: string | null | undefined): ReportApprovalPolicy | null {
  return registry.get(id)
}

registerReportApprovalPolicy({
  id: BUILT_IN_REPORT_APPROVAL_POLICY_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
})

function applicablePolicies(ctx: ReportApprovalContext): ReportApprovalPolicy[] {
  const scoped = hasResolverScope(ctx)
  return registry
    .list()
    .filter((policy) => scoped || policy.id === BUILT_IN_REPORT_APPROVAL_POLICY_ID)
}

/** The first refusal wins; every policy must agree before a close proceeds. */
export function evaluateReportClosePolicies(ctx: ReportApprovalContext): ReportApprovalRefusal | null {
  for (const policy of applicablePolicies(ctx)) {
    const verdict = policy.canClose?.(ctx)
    if (verdict) return verdict
  }
  return null
}

export function evaluateReportUnlockPolicies(ctx: ReportApprovalContext): ReportApprovalRefusal | null {
  for (const policy of applicablePolicies(ctx)) {
    const verdict = policy.canUnlock?.(ctx)
    if (verdict) return verdict
  }
  return null
}

export type ReportApprovalNotificationFailure = {
  policyId: string
  error: unknown
}

/**
 * Fired after a close has committed. A throwing hook cannot unwind a freeze that
 * already happened, so failures are collected and handed back for the caller to
 * log — the same trade the export route makes with its audit row.
 */
export async function notifyReportClosed(
  ctx: ReportApprovalContext,
): Promise<ReportApprovalNotificationFailure[]> {
  const failures: ReportApprovalNotificationFailure[] = []
  for (const policy of applicablePolicies(ctx)) {
    if (!policy.onClosed) continue
    try {
      await policy.onClosed(ctx)
    } catch (error) {
      failures.push({ policyId: policy.id, error })
    }
  }
  return failures
}
