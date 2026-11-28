import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { assertActorCanModifySuperAdminUserTarget } from '@open-mercato/core/modules/auth/lib/grantChecks'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import type { MfaAdminAuthScope, MfaAdminService } from '../services/MfaAdminService'

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
    const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
    const scope: MfaAdminAuthScope = {
      tenantId: (ctx.auth.tenantId as string | null | undefined) ?? null,
      organizationId: (ctx.auth.orgId as string | null | undefined) ?? null,
      isSuperAdmin,
    }
    const em = ctx.container.resolve<EntityManager>('em')
    if (!isSuperAdmin) {
      const target = scope.tenantId
        ? await findOneWithDecryption(
            em,
            User,
            { id: parsed.data.userId, tenantId: scope.tenantId, deletedAt: null },
            undefined,
            { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
          )
        : null
      if (!target || (
        scope.organizationId != null
        && target.organizationId != null
        && target.organizationId !== scope.organizationId
      )) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(404, { error: translate('auth.users.form.errors.notFound', 'User not found') })
      }
    }
    await assertActorCanModifySuperAdminUserTarget({
      em,
      rbacService: ctx.container.resolve<RbacService>('rbacService'),
      requireBoundRbac: true,
      actorUserId: ctx.auth.sub,
      tenantId: ctx.auth.tenantId ?? null,
      organizationId: ctx.auth.orgId ?? null,
      targetUserId: parsed.data.userId,
    })
    try {
      await mfaAdminService.resetUserMfa(
        ctx.auth.sub,
        parsed.data.userId,
        parsed.data.reason,
        scope,
      )
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
