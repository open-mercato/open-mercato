import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  actionLogCreateSchema,
  actionLogListSchema,
  type ActionLogCreateInput,
  type ActionLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null
let decryptionWarningLogged = false

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

export class ActionLogService {
  constructor(
    private readonly em: EntityManager,
    private readonly tenantEncryptionService?: TenantDataEncryptionService,
  ) {}

  private async decryptEntries(entries: ActionLog | ActionLog[] | null | undefined): Promise<void> {
    if (!entries) return
    if (!this.tenantEncryptionService?.isEnabled()) return
    const list = Array.isArray(entries) ? entries : [entries]
    for (const entry of list) {
      try {
        const decrypted = await this.tenantEncryptionService.decryptEntityPayload(
          'audit_logs:action_log',
          entry as unknown as Record<string, unknown>,
          entry.tenantId ?? null,
          entry.organizationId ?? null,
        )
        Object.assign(entry as any, decrypted)
      } catch (err) {
        if (!decryptionWarningLogged) {
          decryptionWarningLogged = true
          // eslint-disable-next-line no-console
          console.warn('[audit_logs] failed to decrypt action log entry', err)
        }
      }
    }
  }

  async log(input: ActionLogCreateInput): Promise<ActionLog | null> {
    let data: ActionLogCreateInput
    const schema = actionLogCreateSchema as typeof actionLogCreateSchema & { _zod?: unknown }
    const canValidate = Boolean(schema && typeof schema.parse === 'function')
    const shouldValidate = canValidate && runtimeValidationAvailable !== false
    if (shouldValidate) {
      try {
        data = schema.parse(input)
        runtimeValidationAvailable = true
      } catch (err) {
        if (!isZodRuntimeMissing(err) && !validationWarningLogged) {
          validationWarningLogged = true
          // eslint-disable-next-line no-console
          console.warn('[audit_logs] falling back to permissive action log payload parser', err)
        }
        if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
        data = this.normalizeInput(input)
      }
    } else {
      data = this.normalizeInput(input)
    }
    const fork = this.em.fork()
    const log = fork.create(ActionLog, {
      tenantId: data.tenantId ?? null,
      organizationId: data.organizationId ?? null,
      actorUserId: data.actorUserId ?? null,
      commandId: data.commandId,
      actionLabel: data.actionLabel ?? null,
      resourceKind: data.resourceKind ?? null,
      resourceId: data.resourceId ?? null,
      executionState: data.executionState ?? 'done',
      undoToken: data.undoToken ?? null,
      commandPayload: data.commandPayload ?? null,
      snapshotBefore: data.snapshotBefore ?? null,
      snapshotAfter: data.snapshotAfter ?? null,
      changesJson: data.changes ?? null,
      contextJson: data.context ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await fork.persistAndFlush(log)
    await this.decryptEntries(log)
    return log
  }

  private normalizeInput(input: Partial<ActionLogCreateInput> | null | undefined): ActionLogCreateInput {
    if (!input) {
      return {
        tenantId: null,
        organizationId: null,
        actorUserId: null,
        commandId: 'unknown',
        actionLabel: undefined,
        resourceKind: undefined,
        resourceId: undefined,
        executionState: 'done',
        undoToken: undefined,
        commandPayload: undefined,
        snapshotBefore: undefined,
        snapshotAfter: undefined,
        changes: undefined,
        context: undefined,
      }
    }
    const toNullableUuid = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
    const toOptionalString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined)

    const normalizeRecordLike = (value: unknown): ActionLogCreateInput['changes'] => {
      if (value === null) return null
      if (Array.isArray(value)) return value
      if (typeof value === 'object') return value as Record<string, unknown>
      return undefined
    }
    const normalizeContext = (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined)

    return {
      tenantId: toNullableUuid(input.tenantId),
      organizationId: toNullableUuid(input.organizationId),
      actorUserId: toNullableUuid(input.actorUserId),
      commandId: typeof input.commandId === 'string' && input.commandId.length > 0 ? input.commandId : 'unknown',
      actionLabel: toOptionalString(input.actionLabel),
      resourceKind: toOptionalString(input.resourceKind),
      resourceId: toOptionalString(input.resourceId),
      executionState: input.executionState === 'undone' || input.executionState === 'failed' ? input.executionState : 'done',
      undoToken: toOptionalString(input.undoToken),
      commandPayload: input.commandPayload,
      snapshotBefore: input.snapshotBefore,
      snapshotAfter: input.snapshotAfter,
      changes: normalizeRecordLike(input.changes),
      context: normalizeContext(input.context),
    }
  }

  async list(query: Partial<ActionLogListQuery>) {
    const parsed = actionLogListSchema.parse({
      ...query,
      limit: query.limit ?? 50,
    })

    const where: FilterQuery<ActionLog> = { deletedAt: null }
    if (parsed.tenantId) where.tenantId = parsed.tenantId
    if (parsed.organizationId) where.organizationId = parsed.organizationId
    if (parsed.actorUserId) where.actorUserId = parsed.actorUserId
    if (parsed.undoableOnly) where.undoToken = { $ne: null } as any
    if (parsed.before) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $lt: parsed.before } as any
    if (parsed.after) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $gt: parsed.after } as any

    const results = await this.em.find(
      ActionLog,
      where,
      {
        orderBy: { createdAt: 'desc' },
        limit: parsed.limit,
      },
    )
    await this.decryptEntries(results)
    return results
  }

  async latestUndoableForActor(actorUserId: string, scope: { tenantId?: string | null; organizationId?: string | null }) {
    const where: FilterQuery<ActionLog> = {
      actorUserId,
      undoToken: { $ne: null } as any,
      executionState: 'done',
      deletedAt: null,
    }
    if (scope.tenantId) where.tenantId = scope.tenantId
    if (scope.organizationId) where.organizationId = scope.organizationId

    const entry = await this.em.findOne(ActionLog, where, { orderBy: { createdAt: 'desc' } })
    await this.decryptEntries(entry)
    return entry
  }

  async markUndone(id: string) {
    const log = await this.em.findOne(ActionLog, { id, deletedAt: null })
    if (!log) return null
    log.executionState = 'undone'
    log.undoToken = null
    await this.em.flush()
    return log
  }

  async findByUndoToken(undoToken: string) {
    const entry = await this.em.findOne(ActionLog, { undoToken, deletedAt: null })
    await this.decryptEntries(entry)
    return entry
  }

  async findById(id: string) {
    const entry = await this.em.findOne(ActionLog, { id, deletedAt: null })
    await this.decryptEntries(entry)
    return entry
  }

  async latestUndoableForResource(params: {
    actorUserId: string
    tenantId?: string | null
    organizationId?: string | null
    resourceKind?: string | null
    resourceId?: string | null
  }) {
    const where: FilterQuery<ActionLog> = {
      actorUserId: params.actorUserId,
      undoToken: { $ne: null } as any,
      executionState: 'done',
      deletedAt: null,
    }
    if (params.tenantId) where.tenantId = params.tenantId
    if (params.organizationId) where.organizationId = params.organizationId
    if (params.resourceKind) where.resourceKind = params.resourceKind
    if (params.resourceId) where.resourceId = params.resourceId
    const entry = await this.em.findOne(ActionLog, where, { orderBy: { createdAt: 'desc' } })
    await this.decryptEntries(entry)
    return entry
  }

  async latestUndoneForActor(actorUserId: string, scope: { tenantId?: string | null; organizationId?: string | null }) {
    const where: FilterQuery<ActionLog> = {
      actorUserId,
      executionState: 'undone',
      deletedAt: null,
    }
    if (scope.tenantId) where.tenantId = scope.tenantId
    if (scope.organizationId) where.organizationId = scope.organizationId
    const entry = await this.em.findOne(ActionLog, where, { orderBy: { updatedAt: 'desc' } })
    await this.decryptEntries(entry)
    return entry
  }

  async markRedone(id: string) {
    const log = await this.em.findOne(ActionLog, { id, deletedAt: null })
    if (!log) return null
    log.executionState = 'redone'
    log.undoToken = null
    await this.em.flush()
    return log
  }
}
