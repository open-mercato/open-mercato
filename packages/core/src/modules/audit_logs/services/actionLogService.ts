import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  actionLogCreateSchema,
  actionLogListSchema,
  type ActionLogCreateInput,
  type ActionLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

export class ActionLogService {
  constructor(private readonly em: EntityManager) {}

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
    })
    await fork.persistAndFlush(log)
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

    return await this.em.find(
      ActionLog,
      where,
      {
        orderBy: { createdAt: 'desc' },
        limit: parsed.limit,
      },
    )
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

    return await this.em.findOne(ActionLog, where, { orderBy: { createdAt: 'desc' } })
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
    return await this.em.findOne(ActionLog, { undoToken, deletedAt: null })
  }
}
