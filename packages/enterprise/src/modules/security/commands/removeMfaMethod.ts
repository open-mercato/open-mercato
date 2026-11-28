import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { UserMfaMethod } from '../data/entities'
import { removeMfaMethodSchema } from '../data/validators'
import type { MfaService } from '../services/MfaService'

export const commandId = 'security.mfa.method.remove'

type MfaMethodSnapshot = {
  id: string
  userId: string
  tenantId: string
  organizationId: string | null
  type: string
  label: string | null
  isActive: boolean
  lastUsedAt: string | null
  deletedAt: string | null
}

type MfaServiceErrorLike = Error & {
  statusCode: number
}

function isMfaServiceError(error: unknown): error is MfaServiceErrorLike {
  if (!(error instanceof Error)) return false
  const maybe = error as Partial<MfaServiceErrorLike>
  return error.name === 'MfaServiceError' && typeof maybe.statusCode === 'number'
}

function toOptionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function captureMethodSnapshot(method: UserMfaMethod): MfaMethodSnapshot {
  return {
    id: method.id,
    userId: method.userId,
    tenantId: method.tenantId,
    organizationId: method.organizationId ?? null,
    type: method.type,
    label: method.label ?? null,
    isActive: method.isActive,
    lastUsedAt: toOptionalIso(method.lastUsedAt),
    deletedAt: toOptionalIso(method.deletedAt),
  }
}

registerCommand({
  id: commandId,
  isUndoable: false,
  async prepare(rawInput, ctx) {
    const parsed = removeMfaMethodSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const method = await findOneWithDecryption(em, UserMfaMethod, {
      id: parsed.data.id,
      userId: ctx.auth.sub,
      deletedAt: null,
    }, undefined, { tenantId: ctx.auth.tenantId, organizationId: ctx.auth.orgId })
    return { before: method ? captureMethodSnapshot(method) : null }
  },
  async execute(rawInput, ctx) {
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const parsed = removeMfaMethodSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }

    const mfaService = ctx.container.resolve<MfaService>('mfaService')
    try {
      await mfaService.removeMethod(ctx.auth.sub, parsed.data.id)
      return { ok: true as const }
    } catch (error) {
      if (isMfaServiceError(error)) {
        throw new CrudHttpError(error.statusCode, { error: error.message })
      }
      throw error
    }
  },
  async buildLog({ input, snapshots, ctx }) {
    const { translate } = await resolveTranslations()
    const payload = removeMfaMethodSchema.parse(input)
    const before = (snapshots.before as MfaMethodSnapshot | null) ?? null
    return {
      replayable: false,
      actionLabel: translate('security.audit.mfa.method.remove', 'Remove MFA method'),
      resourceKind: 'security.mfa_method',
      resourceId: payload.id,
      actorUserId: ctx.auth?.sub ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      context: {
        source: 'security.mfa.methods',
      },
    }
  },
})
