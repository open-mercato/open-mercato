import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { MfaEnforcementService } from '../services/MfaEnforcementService'
import { requireSudo, SudoRequiredError } from './sudo-middleware'

export async function requireMfaEnrollmentSudo(
  request: Request,
  userId: string,
  hasActiveMethods: boolean,
): Promise<void> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub || auth.sub !== userId) {
    throw new SudoRequiredError('security.mfa.self.manage')
  }
  if (!hasActiveMethods && auth.tenantId) {
    const container = await createRequestContainer()
    const enforcement = container.resolve<MfaEnforcementService>('mfaEnforcementService')
    const compliance = await enforcement.checkUserCompliance(userId)
    if (compliance.enforced && !compliance.compliant) return
  }
  await requireSudo(request, 'security.mfa.self.manage')
}
