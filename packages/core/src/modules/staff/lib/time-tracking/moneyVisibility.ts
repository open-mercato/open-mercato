import { resolveFeatureAccess } from './featureAccess'

export const RATES_FEATURE = 'staff.timesheets.rates.view'

type ContainerLike = { resolve: (name: string) => unknown }

/**
 * Whether the caller may see rates, costs and amounts.
 *
 * One decision, made once, in one direction — because the same feature was
 * previously answered by five hand-rolled gates with two opposite failure
 * defaults. Three report surfaces (preview, export, sheet) read
 * `grantedFeatures === null || authorizeFeatures(...)`, so an unreadable grant
 * set *opened* the money fields; `my-work` and the entries list returned `false`
 * in the same situation. None of the three report routes declares
 * `staff.timesheets.rates.view` in its metadata — they require only
 * `reports.view` — so nothing else stood between a plain report viewer and the
 * customer's hourly rate when RBAC was unavailable.
 *
 * Failing closed is the only defensible default here: hiding a rate from someone
 * entitled to it is a support ticket, showing it to someone who is not is a
 * disclosure.
 *
 * The lookup itself belongs to `resolveFeatureAccess`, the module's single RBAC
 * authority: it asks `userHasAllFeatures` (the call that carries `isSuperAdmin`
 * internally), denies on every failure path, and logs the failure rather than
 * swallowing it. This function stays as the *name* of the question, so a route
 * reads `canSeeMoney` instead of a bare feature string — but it re-derives
 * nothing and cannot drift from the rest of the module.
 */
export async function resolveMoneyVisibility(
  container: ContainerLike,
  userId: string | null,
  scope: { tenantId: string | null; organizationId: string | null },
): Promise<boolean> {
  return (await resolveFeatureAccess(container, userId, [RATES_FEATURE], scope)).allowed
}
