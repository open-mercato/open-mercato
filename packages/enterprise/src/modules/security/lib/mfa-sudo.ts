import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { MfaEnforcementService } from '../services/MfaEnforcementService'
import { requireSudo, SudoRequiredError, isSudoRequiredError } from './sudo-middleware'

export async function requireMfaEnrollmentSudo(
  request: Request,
  userId: string,
  hasActiveMethods: boolean,
  context?: Pick<CommandRuntimeContext, 'auth' | 'container'>,
): Promise<void> {
  if (context?.auth?.sub && context.auth.sub !== userId) {
    throw new SudoRequiredError('security.mfa.self.manage')
  }
  if (!hasActiveMethods && context?.auth?.tenantId) {
    const enforcement = context.container.resolve<MfaEnforcementService>('mfaEnforcementService')
    const compliance = await enforcement.checkUserCompliance(userId)
    if (compliance.enforced && !compliance.compliant) return
  }
  await requireSudo(request, 'security.mfa.self.manage', context)
}

export async function requireMfaCommandSudo(context: Pick<CommandRuntimeContext, 'request' | 'auth' | 'container'>): Promise<void> {
  if (!context.request) return
  try {
    await requireSudo(context.request, 'security.mfa.self.manage', context)
  } catch (error) {
    if (isSudoRequiredError(error)) throw new CrudHttpError(error.statusCode, error.body)
    throw error
  }
}
