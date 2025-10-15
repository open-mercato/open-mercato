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
    let data: AccessLogCreateInput
    const canValidate = accessLogCreateSchema && typeof (accessLogCreateSchema as any).parse === 'function'
    if (canValidate) {
      try {
        data = accessLogCreateSchema.parse(input)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[audit_logs] failed to validate access log payload, using fallback', err)
        data = this.normalizeInput(input)
      }
    } else {
      data = this.normalizeInput(input)
    }
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

  private normalizeInput(input: Partial<AccessLogCreateInput> | null | undefined): AccessLogCreateInput {
    if (!input) {
      return {
        tenantId: null,
        organizationId: null,
        actorUserId: null,
        resourceKind: 'unknown',
        resourceId: 'unknown',
        accessType: 'unknown',
        fields: undefined,
        context: undefined,
      }
    }
    const fields = Array.isArray(input.fields)
      ? input.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
      : undefined
    const context = typeof input.context === 'object' && input.context !== null
      ? input.context as Record<string, unknown>
      : undefined
    return {
      tenantId: input.tenantId ?? null,
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      resourceKind: String(input.resourceKind || 'unknown'),
      resourceId: String(input.resourceId || 'unknown'),
      accessType: String(input.accessType || 'unknown'),
      fields,
      context,
    }
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
