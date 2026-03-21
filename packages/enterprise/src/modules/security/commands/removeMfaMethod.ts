import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
  secret: string | null
  providerMetadata: Record<string, unknown> | null
  isActive: boolean
  lastUsedAt: string | null
  deletedAt: string | null
}

type RemoveMfaMethodUndoPayload = {
  before: MfaMethodSnapshot | null
  after?: MfaMethodSnapshot | null
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
    secret: method.secret ?? null,
    providerMetadata: method.providerMetadata ?? null,
    isActive: method.isActive,
    lastUsedAt: toOptionalIso(method.lastUsedAt),
    deletedAt: toOptionalIso(method.deletedAt),
  }
}

function readUndoPayload(logEntry: unknown): RemoveMfaMethodUndoPayload | null {
  if (!logEntry || typeof logEntry !== 'object') return null
  const record = logEntry as {
    payload?: { undo?: RemoveMfaMethodUndoPayload }
    commandPayload?: { undo?: RemoveMfaMethodUndoPayload }
  }
  return record.commandPayload?.undo ?? record.payload?.undo ?? null
}

registerCommand({
  id: commandId,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = removeMfaMethodSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid payload', issues: parsed.error.issues })
    }
    if (!ctx.auth?.sub) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const method = await em.findOne(UserMfaMethod, {
      id: parsed.data.id,
      userId: ctx.auth.sub,
      deletedAt: null,
    })
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const payload = removeMfaMethodSchema.parse(input)
    const method = await em.findOne(UserMfaMethod, { id: payload.id })
    const before = (snapshots.before as RemoveMfaMethodUndoPayload['before']) ?? null
    const after = method ? captureMethodSnapshot(method) : null
    return {
      actionLabel: translate('security.audit.mfa.method.remove', 'Remove MFA method'),
      resourceKind: 'security.mfa_method',
      resourceId: payload.id,
      actorUserId: ctx.auth?.sub ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      payload: {
        methodType: before?.type ?? after?.type ?? null,
        undo: {
          before,
          after,
        } satisfies RemoveMfaMethodUndoPayload,
      },
      context: {
        source: 'security.mfa.methods',
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = readUndoPayload(logEntry)?.before
    if (!before) return

    const em = ctx.container.resolve<EntityManager>('em')
    const method = await em.findOne(UserMfaMethod, { id: before.id })
    if (!method) {
      const restored = em.create(UserMfaMethod, {
        id: before.id,
        userId: before.userId,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        type: before.type,
        label: before.label,
        secret: before.secret,
        providerMetadata: before.providerMetadata,
        isActive: before.isActive,
        lastUsedAt: before.lastUsedAt ? new Date(before.lastUsedAt) : null,
        deletedAt: before.deletedAt ? new Date(before.deletedAt) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(restored)
      await em.flush()
      return
    }

    method.userId = before.userId
    method.tenantId = before.tenantId
    method.organizationId = before.organizationId
    method.type = before.type
    method.label = before.label
    method.secret = before.secret
    method.providerMetadata = before.providerMetadata
    method.isActive = before.isActive
    method.lastUsedAt = before.lastUsedAt ? new Date(before.lastUsedAt) : null
    method.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    method.updatedAt = new Date()
    await em.flush()
  },
})
