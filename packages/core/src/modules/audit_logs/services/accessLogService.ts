import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { AccessLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  accessLogCreateSchema,
  accessLogListSchema,
  type AccessLogCreateInput,
  type AccessLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { E } from '#generated/entities.ids.generated'

const CORE_RESOURCE_KINDS = new Set<string>(['auth.user', 'auth.role'])

function toPositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const CORE_RETENTION_DAYS = toPositiveNumber(process.env.AUDIT_LOGS_CORE_RETENTION_DAYS, 7)
const NON_CORE_RETENTION_HOURS = toPositiveNumber(process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS, 8)
const CORE_RETENTION_MS = CORE_RETENTION_DAYS * 24 * 60 * 60 * 1000
const NON_CORE_RETENTION_MS = NON_CORE_RETENTION_HOURS * 60 * 60 * 1000

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

export class AccessLogService {
  constructor(private readonly em: EntityManager) {}

  async log(input: AccessLogCreateInput): Promise<AccessLog | null> {
    let data: AccessLogCreateInput
    const schema = accessLogCreateSchema as typeof accessLogCreateSchema & { _zod?: unknown }
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
          console.warn('[audit_logs] falling back to permissive access log payload parser', err)
        }
        if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
        data = this.normalizeInput(input)
      }
    } else {
      data = this.normalizeInput(input)
    }
    const fork = this.em.fork({ useContext: true })
    const fields = Array.isArray(data.fields) && data.fields.length ? data.fields : null
    const context = data.context && Object.keys(data.context).length ? data.context : null
    const createdAt = new Date()
    const tenantId = data.tenantId ?? null
    const organizationId = data.organizationId ?? null

    type AccessLogEncryptedFields = {
      resourceKind?: unknown
      resourceId?: unknown
      accessType?: unknown
      fieldsJson?: unknown
      contextJson?: unknown
    }
    const encryption = resolveTenantEncryptionService(fork as any)
    const encrypted = encryption
      ? ((await encryption.encryptEntityPayload(
          E.audit_logs.access_log,
          {
            resourceKind: data.resourceKind,
            resourceId: data.resourceId,
            accessType: data.accessType,
            fieldsJson: fields,
            contextJson: context,
          },
          tenantId,
          organizationId,
        )) as AccessLogEncryptedFields)
      : null

    const payload = {
      resourceKind: encrypted?.resourceKind ?? data.resourceKind,
      resourceId: encrypted?.resourceId ?? data.resourceId,
      accessType: encrypted?.accessType ?? data.accessType,
      fieldsJson: encrypted?.fieldsJson ?? fields,
      contextJson: encrypted?.contextJson ?? context,
    }

    const rows = await fork.getConnection().execute(
      `insert into "access_logs" ("tenant_id", "organization_id", "actor_user_id", "resource_kind", "resource_id", "access_type", "fields_json", "context_json", "created_at", "deleted_at") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning "id"`,
      [
        tenantId,
        organizationId,
        data.actorUserId ?? null,
        payload.resourceKind,
        payload.resourceId,
        payload.accessType,
        payload.fieldsJson !== null && payload.fieldsJson !== undefined ? JSON.stringify(payload.fieldsJson) : null,
        payload.contextJson !== null && payload.contextJson !== undefined ? JSON.stringify(payload.contextJson) : null,
        createdAt,
        null,
      ],
    )
    await this.rotate(fork)
    const id = Array.isArray(rows) && rows.length > 0 ? rows[0]?.id ?? null : null
    if (!id) return null
    const entry = fork.create(AccessLog, {
      id,
      tenantId: data.tenantId ?? null,
      organizationId: data.organizationId ?? null,
      actorUserId: data.actorUserId ?? null,
      resourceKind: data.resourceKind,
      resourceId: data.resourceId,
      accessType: data.accessType,
      fieldsJson: fields,
      contextJson: context,
      createdAt,
    })
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
    const toNullableUuid = (value: unknown) => {
      if (typeof value !== 'string' || value.length === 0) return null
      // Extract UUID from "api_key:<uuid>" format (used by workflow authentication)
      if (value.startsWith('api_key:')) {
        return value.slice('api_key:'.length)
      }
      return value
    }
    const fields = Array.isArray(input.fields)
      ? input.fields.filter((f): f is string => typeof f === 'string' && f.length > 0)
      : undefined
    const context = typeof input.context === 'object' && input.context !== null
      ? input.context as Record<string, unknown>
      : undefined
    return {
      tenantId: toNullableUuid(input.tenantId),
      organizationId: toNullableUuid(input.organizationId),
      actorUserId: toNullableUuid(input.actorUserId),
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
    })

    const where: FilterQuery<AccessLog> = { deletedAt: null }
    if (parsed.tenantId) where.tenantId = parsed.tenantId
    if (parsed.organizationId) where.organizationId = parsed.organizationId
    if (parsed.actorUserId) where.actorUserId = parsed.actorUserId
    if (parsed.resourceKind) where.resourceKind = parsed.resourceKind
    if (parsed.accessType) where.accessType = parsed.accessType
    if (parsed.before) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $lt: parsed.before } as any
    if (parsed.after) where.createdAt = { ...(where.createdAt as Record<string, any> | undefined), $gt: parsed.after } as any

    const pageSize = parsed.pageSize ?? parsed.limit ?? 50
    const page = parsed.page ?? 1
    const offset = (page - 1) * pageSize

    const [items, total] = await this.em.findAndCount(
      AccessLog,
      where,
      {
        orderBy: { createdAt: 'desc' },
        limit: pageSize,
        offset,
      },
    )

    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)))
    return { items, total, page, pageSize, totalPages }
  }

  private async rotate(fork: EntityManager) {
    const now = Date.now()
    const coreCutoff = new Date(now - CORE_RETENTION_MS)
    const nonCoreCutoff = new Date(now - NON_CORE_RETENTION_MS)
    try {
      if (CORE_RESOURCE_KINDS.size > 0) {
        await fork.nativeDelete(AccessLog, {
          resourceKind: { $in: Array.from(CORE_RESOURCE_KINDS) },
          createdAt: { $lt: coreCutoff },
        })
      }
      await fork.nativeDelete(AccessLog, {
        resourceKind: { $nin: Array.from(CORE_RESOURCE_KINDS) },
        createdAt: { $lt: nonCoreCutoff },
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[audit_logs] failed to rotate access logs', err)
    }
  }
}
