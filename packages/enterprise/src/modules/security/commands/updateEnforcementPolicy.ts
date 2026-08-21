import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { updateEnforcementPolicySchema } from '../data/validators'
import type {
  MfaEnforcementAuthScope,
  MfaEnforcementService,
} from '../services/MfaEnforcementService'

export const commandId = 'security.enforcement.update'

const commandSchema = z.object({
  id: z.string().uuid(),
  data: updateEnforcementPolicySchema,
})

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
    const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
    const scope: MfaEnforcementAuthScope = {
      tenantId: (ctx.auth.tenantId as string | null | undefined) ?? null,
      organizationId: (ctx.auth.orgId as string | null | undefined) ?? null,
      isSuperAdmin,
    }
    try {
      await enforcementService.updatePolicy(parsed.data.id, parsed.data.data, ctx.auth.sub, scope)
      return { ok: true as const }
    } catch (error) {
      if (isEnforcementServiceError(error)) {
        throw new CrudHttpError(error.statusCode, { error: error.message })
      }
      throw error
    }
  },
  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = input as CommandInput
    return {
      actionLabel: translate('security.audit.enforcement.update', 'Update enforcement policy'),
      resourceKind: 'security.enforcement_policy',
      resourceId: payload.id,
      tenantId: payload.data.tenantId ?? null,
      organizationId: payload.data.organizationId ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      payload,
      context: {
        source: 'security.enforcement',
      },
    }
  },
})
