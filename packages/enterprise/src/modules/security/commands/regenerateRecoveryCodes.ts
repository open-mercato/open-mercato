import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { regenerateRecoveryCodesSchema } from '../data/validators'
import type { MfaService } from '../services/MfaService'

export const commandId = 'security.mfa.recovery_codes.regenerate'

type MfaServiceErrorLike = Error & {
  statusCode: number
}

function isMfaServiceError(error: unknown): error is MfaServiceErrorLike {
  if (!(error instanceof Error)) return false
  const maybe = error as Partial<MfaServiceErrorLike>
  return error.name === 'MfaServiceError' && typeof maybe.statusCode === 'number'
}

registerCommand({
  id: commandId,
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const parsed = regenerateRecoveryCodesSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const mfaService = ctx.container.resolve<MfaService>('mfaService')
    try {
      const recoveryCodes = await mfaService.generateRecoveryCodes(ctx.auth.sub)
      return { ok: true as const, recoveryCodes }
    } catch (error) {
      if (isMfaServiceError(error)) {
        throw new CrudHttpError(error.statusCode, { error: error.message })
      }
      throw error
    }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    const commandResult = result as { recoveryCodes?: string[] }
    return {
      actionLabel: translate('security.audit.recovery.regenerate', 'Regenerate MFA recovery codes'),
      resourceKind: 'security.recovery_codes',
      resourceId: ctx.auth?.sub ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      payload: {
        total: Array.isArray(commandResult.recoveryCodes) ? commandResult.recoveryCodes.length : 0,
        nonUndoable: true,
      },
      context: {
        source: 'security.mfa.recovery_codes',
      },
    }
  },
})
