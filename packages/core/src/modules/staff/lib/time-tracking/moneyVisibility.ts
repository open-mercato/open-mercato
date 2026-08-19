import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'time-tracking/moneyVisibility' })

export const RATES_FEATURE = 'staff.timesheets.rates.view'

type RbacServiceLike = {
  userHasAllFeatures?: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

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
 * disclosure. The failure is logged rather than swallowed, so an outage that
 * quietly strips money from every report is visible instead of being mistaken for
 * a permissions change.
 *
 * `userHasAllFeatures` is the authority rather than a grant array matched
 * locally: it is the same call `my-work` and the entries list already make, it
 * carries `isSuperAdmin` internally, and asking one question in one way is what
 * keeps two surfaces from disagreeing about the same person.
 */
export async function resolveMoneyVisibility(
  container: ContainerLike,
  userId: string | null,
  scope: { tenantId: string | null; organizationId: string | null },
): Promise<boolean> {
  if (!userId) return false
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.userHasAllFeatures) {
      logger.warn('rates.view could not be evaluated: rbacService unavailable', { userId })
      return false
    }
    return (await rbac.userHasAllFeatures(userId, [RATES_FEATURE], scope)) === true
  } catch (err) {
    logger.warn('rates.view could not be evaluated; hiding money fields', { err, userId })
    return false
  }
}
