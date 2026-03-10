import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

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

export async function resolveMfaEnrollmentRedirect(args: {
  auth: AuthContext
  pathname: string
  container: ServiceContainerLike
}): Promise<string | null> {
  const { auth, pathname, container } = args
  if (!auth || typeof auth.sub !== 'string' || auth.sub.length === 0) return null
  if (auth.mfa_pending === true) return null
  if (isExemptPath(pathname)) return null

  const enforcementService = resolveEnforcementService(container)
  if (!enforcementService) return null

  try {
    const compliance = await enforcementService.checkUserCompliance(auth.sub)
    if (!compliance.enforced || compliance.compliant) return null

    const searchParams = new URLSearchParams({
      redirect: pathname,
      reason: 'mfa_enrollment_required',
    })
    if (compliance.deadline && compliance.deadline.getTime() <= Date.now()) {
      searchParams.set('overdue', '1')
    }
    return `${MFA_ENROLLMENT_PATH}?${searchParams.toString()}`
  } catch {
    return null
  }
}

export default resolveMfaEnrollmentRedirect
