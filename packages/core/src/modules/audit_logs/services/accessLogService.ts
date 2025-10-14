import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { AccessLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  accessLogCreateSchema,
  accessLogListSchema,
  type AccessLogCreateInput,
  type AccessLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'

export class AccessLogService {
  constructor(private readonly em: EntityManager) {}

  async log(input: AccessLogCreateInput) {
    const data = accessLogCreateSchema.parse(input)
    const fork = this.em.fork()
    const entry = fork.create(AccessLog, {
      tenantId: data.tenantId ?? null,
      organizationId: data.organizationId ?? null,
      actorUserId: data.actorUserId ?? null,
      resourceKind: data.resourceKind,
      resourceId: data.resourceId,
      accessType: data.accessType,
      fieldsJson: data.fields ?? null,
      contextJson: data.context ?? null,
    })
    await fork.persistAndFlush(entry)
    return entry
  }

  async list(query: Partial<AccessLogListQuery>) {
    const parsed = accessLogListSchema.parse({
      ...query,
      limit: query.limit ?? 50,
    })

    const where: FilterQuery<AccessLog> = { deletedAt: null }
    if (parsed.tenantId) where.tenantId = parsed.tenantId
    if (parsed.organizationId) where.organizationId = parsed.organizationId
    if (parsed.actorUserId) where.actorUserId = parsed.actorUserId
    if (parsed.resourceKind) where.resourceKind = parsed.resourceKind
    if (parsed.accessType) where.accessType = parsed.accessType
    if (parsed.before) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $lt: parsed.before } as any
    if (parsed.after) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $gt: parsed.after } as any

    return await this.em.find(
      AccessLog,
      where,
      {
        orderBy: { createdAt: 'desc' },
        limit: parsed.limit,
      },
    )
  }
}
