import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isEnforcementDeadlineOverdue } from '../services/MfaEnforcementService'
import { readSecurityModuleConfig } from './security-config'

const logger = createLogger('ent_security').child({ component: 'enforcement-redirect' })

const MFA_ENROLLMENT_PATH = '/backend/profile/security/mfa'

type MfaComplianceResult = {
  compliant: boolean
  enforced: boolean
  deadline?: Date
}

type MfaEnforcementServiceLike = {
  checkUserCompliance: (userId: string) => Promise<MfaComplianceResult>
}

type ServiceContainerLike = {
  resolve: (name: string) => unknown
}

function resolveDeadlineRedirectState(deadline?: Date): {
  overdue: boolean
  shouldRedirect: boolean
} {
  if (!(deadline instanceof Date) || Number.isNaN(deadline.getTime())) {
    return { overdue: false, shouldRedirect: true }
  }

  const overdue = isEnforcementDeadlineOverdue(deadline)
  return { overdue, shouldRedirect: overdue }
}

function isExemptPath(pathname: string): boolean {
  return pathname.startsWith('/backend/profile/security')
}

function resolveEnforcementService(
  container: ServiceContainerLike,
): MfaEnforcementServiceLike | null {
  try {
    const resolved = container.resolve('mfaEnforcementService')
    if (
      !resolved
      || typeof resolved !== 'object'
      || typeof (resolved as { checkUserCompliance?: unknown }).checkUserCompliance !== 'function'
    ) {
      return null
    }
    return resolved as MfaEnforcementServiceLike
  } catch {
    return null
  }
}

function buildEnrollmentRedirect(pathname: string, options: { overdue?: boolean } = {}): string {
  const searchParams = new URLSearchParams({
    redirect: pathname,
    reason: 'mfa_enrollment_required',
  })
  if (options.overdue) {
    searchParams.set('overdue', '1')
  }
  return `${MFA_ENROLLMENT_PATH}?${searchParams.toString()}`
}

export async function resolveMfaEnrollmentRedirect(args: {
  auth: AuthContext
  pathname: string
  container: ServiceContainerLike
}): Promise<string | null> {
  const { auth, pathname, container } = args
  if (!auth || typeof auth.sub !== 'string' || auth.sub.length === 0) return null
  if (auth.mfa_pending === true) return null
  if (isExemptPath(pathname)) return null
  if (readSecurityModuleConfig().mfa.emergencyBypass) return null

  // resolveMfaEnrollmentRedirect is the only gate forcing enforcement-covered
  // users to enroll, so an unavailable enforcement service or a thrown
  // compliance check must fail CLOSED for authenticated tenant-scoped users
  // (#3853). The exempt-path check above keeps the enrollment page itself
  // reachable while the fail-closed state lasts; tenant-less principals have
  // no tenant enforcement policy to violate, so they pass through.
  const hasTenantScope = typeof auth.tenantId === 'string' && auth.tenantId.length > 0

  const enforcementService = resolveEnforcementService(container)
  if (!enforcementService) {
    if (!hasTenantScope) return null
    logger.error('MFA enforcement service unavailable — failing closed to enrollment', {
      userId: auth.sub,
      pathname,
    })
    return buildEnrollmentRedirect(pathname)
  }

  try {
    const compliance = await enforcementService.checkUserCompliance(auth.sub)
    if (!compliance.enforced || compliance.compliant) return null

    const deadlineState = resolveDeadlineRedirectState(compliance.deadline)
    if (!deadlineState.shouldRedirect) return null

    return buildEnrollmentRedirect(pathname, { overdue: deadlineState.overdue })
  } catch (error) {
    if (!hasTenantScope) return null
    logger.error('MFA compliance check failed — failing closed to enrollment', {
      userId: auth.sub,
      pathname,
      err: error,
    })
    return buildEnrollmentRedirect(pathname)
  }
}

export default resolveMfaEnrollmentRedirect
