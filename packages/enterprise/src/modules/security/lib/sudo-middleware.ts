import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { SudoChallengeService } from '../services/SudoChallengeService'

type SudoRequiredBody = {
  error: 'sudo_required'
  message: string
  challengeUrl: '/api/security/sudo/challenge'
}

export class SudoRequiredError extends Error {
  readonly statusCode = 403
  readonly body: SudoRequiredBody

  constructor(targetIdentifier: string) {
    super(`Sudo authentication required for: ${targetIdentifier}`)
    this.name = 'SudoRequiredError'
    this.body = {
      error: 'sudo_required',
      message: this.message,
      challengeUrl: '/api/security/sudo/challenge',
    }
  }
}

export function isSudoRequiredError(error: unknown): error is SudoRequiredError {
  return error instanceof SudoRequiredError
}

export async function requireSudo(
  req: Request,
  targetIdentifier: string,
): Promise<void> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    throw new SudoRequiredError(targetIdentifier)
  }

  const container = await createRequestContainer()
  const sudoChallengeService = container.resolve<SudoChallengeService>('sudoChallengeService')
  const protection = await sudoChallengeService.isProtected(targetIdentifier, auth.tenantId, auth.orgId)
  if (!protection.protected) return

  const token = req.headers.get('x-sudo-token')
  if (!token) {
    throw new SudoRequiredError(targetIdentifier)
  }

  const valid = await sudoChallengeService.validateToken(token, targetIdentifier, {
    expectedUserId: auth.sub,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  if (!valid) {
    throw new SudoRequiredError(targetIdentifier)
  }
}
