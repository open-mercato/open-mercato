import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { MfaAdminService } from '../services/MfaAdminService'

export const commandId = 'security.admin.mfa.reset'

const commandSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().min(1),
})

type CommandInput = z.infer<typeof commandSchema>

type MfaAdminServiceErrorLike = Error & {
  statusCode: number
}

function isMfaAdminServiceError(error: unknown): error is MfaAdminServiceErrorLike {
  if (!(error instanceof Error)) return false
  const maybe = error as Partial<MfaAdminServiceErrorLike>
  return error.name === 'MfaAdminServiceError' && typeof maybe.statusCode === 'number'
}

registerCommand({
  id: commandId,
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const parsed = commandSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const mfaAdminService = ctx.container.resolve<MfaAdminService>('mfaAdminService')
    try {
      await mfaAdminService.resetUserMfa(ctx.auth.sub, parsed.data.userId, parsed.data.reason)
      return { ok: true as const }
    } catch (error) {
      if (isMfaAdminServiceError(error)) {
        throw new CrudHttpError(error.statusCode, { error: error.message })
      }
      throw error
    }
  },
  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = input as CommandInput
    return {
      actionLabel: translate('security.audit.mfa.reset', 'Reset user MFA'),
      resourceKind: 'security.user_mfa',
      resourceId: payload.userId,
      actorUserId: ctx.auth?.sub ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      payload,
      context: {
        source: 'security.admin.users',
      },
    }
  },
})
