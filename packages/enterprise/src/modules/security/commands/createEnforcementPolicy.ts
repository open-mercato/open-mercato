import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforcementPolicySchema } from '../data/validators'
import type { MfaEnforcementService } from '../services/MfaEnforcementService'

export const commandId = 'security.enforcement.create'

const commandSchema = enforcementPolicySchema

type CommandInput = z.infer<typeof commandSchema>

type EnforcementServiceErrorLike = Error & {
  statusCode: number
}

function isEnforcementServiceError(error: unknown): error is EnforcementServiceErrorLike {
  if (!(error instanceof Error)) return false
  const maybe = error as Partial<EnforcementServiceErrorLike>
  return error.name === 'MfaEnforcementServiceError' && typeof maybe.statusCode === 'number'
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

    const enforcementService = ctx.container.resolve<MfaEnforcementService>('mfaEnforcementService')
    try {
      const policy = await enforcementService.createPolicy(parsed.data, ctx.auth.sub)
      return { id: policy.id }
    } catch (error) {
      if (isEnforcementServiceError(error)) {
        throw new CrudHttpError(error.statusCode, { error: error.message })
      }
      throw error
    }
  },
  async buildLog({ input, result, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = input as CommandInput
    const commandResult = result as { id: string }
    return {
      actionLabel: translate('security.audit.enforcement.create', 'Create enforcement policy'),
      resourceKind: 'security.enforcement_policy',
      resourceId: commandResult.id,
      tenantId: payload.tenantId ?? null,
      organizationId: payload.organizationId ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      payload,
      context: {
        source: 'security.enforcement',
      },
    }
  },
})
