import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { PasswordService } from '../services/PasswordService'
import { changePasswordSchema } from '../data/validators'

const commandSchema = changePasswordSchema

export const commandId = 'security.password.change'

type CommandInput = z.infer<typeof commandSchema>

type PasswordServiceErrorLike = Error & {
  statusCode: number
  errors?: string[]
}

function isPasswordServiceError(error: unknown): error is PasswordServiceErrorLike {
  if (!(error instanceof Error)) return false
  const maybe = error as Partial<PasswordServiceErrorLike>
  return error.name === 'PasswordServiceError' && typeof maybe.statusCode === 'number'
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

    const passwordService = ctx.container.resolve<PasswordService>('passwordService')

    try {
      await passwordService.changePassword(
        ctx.auth.sub,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      )
    } catch (error) {
      if (isPasswordServiceError(error)) {
        const statusCode = error.statusCode
        const payload: Record<string, unknown> = { error: error.message }
        if (Array.isArray(error.errors)) {
          payload.errors = error.errors
        }
        throw new CrudHttpError(statusCode, payload)
      }
      throw error
    }

    return { ok: true }
  },
  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const typedInput = input as CommandInput
    return {
      actionLabel: translate('security.audit.password.change', 'Change password'),
      resourceKind: 'security.profile',
      resourceId: ctx.auth?.sub ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      payload: {
        hasCurrentPassword: typedInput.currentPassword.length > 0,
      },
      context: {
        source: 'security.profile.password',
      },
    }
  },
})
