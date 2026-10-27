import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { isEnforcementDeadlineOverdue } from '../services/MfaEnforcementService'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig } from './security-config'

const MFA_ENROLLMENT_PATH = '/backend/profile/security/mfa'
const logger = createLogger('security').child({ component: 'mfa-enforcement-redirect' })

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

type EnforcementServiceResolution = {
  error?: unknown
  service: MfaEnforcementServiceLike | null
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

function createEnrollmentRedirect(pathname: string, overdue = false): string {
  const searchParams = new URLSearchParams({
    redirect: pathname,
    reason: 'mfa_enrollment_required',
  })
  if (overdue) {
    searchParams.set('overdue', '1')
  }
  return `${MFA_ENROLLMENT_PATH}?${searchParams.toString()}`
}

function canFailClosed(auth: NonNullable<AuthContext>): boolean {
  return typeof auth.tenantId === 'string' && auth.tenantId.length > 0
}

function resolveEnforcementService(
  container: ServiceContainerLike,
): EnforcementServiceResolution {
  try {
    const resolved = container.resolve('mfaEnforcementService')
    if (
      !resolved
      || typeof resolved !== 'object'
      || typeof (resolved as { checkUserCompliance?: unknown }).checkUserCompliance !== 'function'
    ) {
      const receivedShape = resolved === null
        ? 'null'
        : Array.isArray(resolved)
          ? 'array'
          : typeof resolved === 'object'
            ? `object with keys: ${Object.keys(resolved).sort((left, right) => left.localeCompare(right)).join(', ') || '(none)'}`
            : typeof resolved
      return {
        error: new TypeError(`[internal] Malformed MFA enforcement service (${receivedShape}); expected checkUserCompliance()`),
        service: null,
      }
    }
    return { service: resolved as MfaEnforcementServiceLike }
  } catch (error) {
    return { error, service: null }
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

  const emergencyBypass = readSecurityModuleConfig().mfa.emergencyBypass

  const enforcementService = resolveEnforcementService(container)
  if (!enforcementService.service) {
    if (!canFailClosed(auth)) return null
    if (emergencyBypass) {
      emitMfaEmergencyBypassActiveWarning('mfa-enrollment-redirect bypassed', {
        userId: auth.sub,
        pathname,
        reason: 'enforcement-service-unavailable',
      })
      return null
    }
    logger.error('Unable to resolve MFA enforcement service; redirecting to enrollment', {
      err: enforcementService.error,
    })
    return createEnrollmentRedirect(pathname)
  }

  try {
    const compliance = await enforcementService.service.checkUserCompliance(auth.sub)
    if (!compliance.enforced || compliance.compliant) return null

    const deadlineState = resolveDeadlineRedirectState(compliance.deadline)
    if (!deadlineState.shouldRedirect) return null

    if (emergencyBypass) {
      emitMfaEmergencyBypassActiveWarning('mfa-enrollment-redirect bypassed', {
        userId: auth.sub,
        pathname,
        enforced: compliance.enforced,
        compliant: compliance.compliant,
        overdue: deadlineState.overdue,
      })
      return null
    }

    return createEnrollmentRedirect(pathname, deadlineState.overdue)
  } catch (error) {
    if (canFailClosed(auth)) {
      if (emergencyBypass) {
        emitMfaEmergencyBypassActiveWarning('mfa-enrollment-redirect bypassed', {
          userId: auth.sub,
          pathname,
          reason: 'compliance-check-failed',
        })
        return null
      }
      logger.error('Unable to verify MFA enforcement compliance; redirecting to enrollment', { err: error })
      return createEnrollmentRedirect(pathname)
    }
    return null
  }
}

export default resolveMfaEnrollmentRedirect
