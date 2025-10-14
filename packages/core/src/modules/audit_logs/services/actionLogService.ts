import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  actionLogCreateSchema,
  actionLogListSchema,
  type ActionLogCreateInput,
  type ActionLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'

export class ActionLogService {
  constructor(private readonly em: EntityManager) {}

  async log(input: ActionLogCreateInput) {
    const data = actionLogCreateSchema.parse(input)
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
