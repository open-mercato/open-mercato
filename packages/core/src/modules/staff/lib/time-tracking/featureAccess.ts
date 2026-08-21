import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'time-tracking/featureAccess' })

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
  userHasAllFeatures?: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

type ContainerLike = { resolve: (name: string) => unknown }

export type FeatureAccess = {
  /** The decision. Fail-closed: `false` whenever it could not be established. */
  allowed: boolean
  /**
   * The caller's grants, for the plumbing that genuinely needs a list (mutation
   * guards, enrichers). Empty when unresolved — check `resolved` before reading
   * anything into an empty array.
   */
  grantedFeatures: string[]
  /**
   * `false` when RBAC could not be consulted — the service was unresolvable, it
   * exposes no way to answer, or the call threw. An unresolved lookup is not the
   * same as "no permission", and a caller that treats it as one silently
   * downgrades somebody's access.
   *
   * `true` therefore means the answer is definite: RBAC produced the grant list,
   * or there was no one to ask about (no user). An empty `grantedFeatures` is
   * only ever a real answer under `resolved`.
   */
  resolved: boolean
}

const DENIED: FeatureAccess = { allowed: false, grantedFeatures: [], resolved: false }

/**
 * One question, one authority, one failure direction.
 *
 * The module previously carried twelve hand-rolled copies of this lookup, each
 * choosing its own semantics: nine returned `[]` on failure (fail-closed, but
 * silently — a manager was demoted to their own project memberships and nothing
 * said why), six returned `null` and were then read as `granted === null || …`
 * (fail-open — which is how an RBAC outage handed hourly rates to plain report
 * viewers), and the rest were somewhere in between. The same
 * `staff.timesheets.rates.view` flag ended up failing closed on two surfaces and
 * open on three.
 *
 * The decision comes from `userHasAllFeatures` rather than from matching the
 * grant array locally. Both paths agree in a healthy runtime — `getGrantedFeatures`
 * expands a super-admin's `'*'` into per-module wildcards that `authorizeFeatures`
 * understands — but only the service call carries `isSuperAdmin` explicitly, and
 * asking one question in one way is what stops two surfaces disagreeing about the
 * same person.
 *
 * The array is returned alongside it because guards and enrichers legitimately
 * need a list. It is deliberately *not* the thing to authorize on.
 *
 * A failed lookup logs. That is the point: the previous silence meant an RBAC
 * outage presented to users as missing data and to operators as nothing at all.
 */
export async function resolveFeatureAccess(
  container: ContainerLike,
  userId: string | null,
  required: readonly string[],
  scope: { tenantId: string | null; organizationId: string | null },
): Promise<FeatureAccess> {
  if (!userId) return { ...DENIED, resolved: true }

  let rbac: RbacServiceLike | undefined
  try {
    rbac = container.resolve('rbacService') as RbacServiceLike | undefined
  } catch (err) {
    logger.warn('rbacService could not be resolved; denying', { err, userId, required })
    return { ...DENIED }
  }
  if (!rbac?.userHasAllFeatures) {
    logger.warn('rbacService cannot answer feature checks; denying', { userId, required })
    return { ...DENIED }
  }

  let allowed = false
  try {
    allowed = (await rbac.userHasAllFeatures(userId, [...required], scope)) === true
  } catch (err) {
    logger.warn('feature check failed; denying', { err, userId, required })
    return { ...DENIED }
  }

  // The grant list is a convenience, not the decision, so a failure to read it
  // downgrades the plumbing that wants a list without touching `allowed`.
  // A service that cannot produce a list at all is the same kind of failure as
  // one whose call throws: the empty array is a fallback, not RBAC's answer, and
  // saying otherwise is how an empty list gets read as authoritative.
  let grantedFeatures: string[] = []
  let resolved = false
  if (!rbac.getGrantedFeatures) {
    logger.warn('rbacService cannot list grants; feature decision still stands', { userId, required })
  } else {
    try {
      grantedFeatures = (await rbac.getGrantedFeatures(userId, scope)) ?? []
      resolved = true
    } catch (err) {
      logger.warn('grant list could not be read; feature decision still stands', { err, userId })
    }
  }

  return { allowed, grantedFeatures, resolved }
}
