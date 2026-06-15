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
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { E } from '#generated/entities.ids.generated'

const CORE_RESOURCE_KINDS = new Set<string>(['auth.user', 'auth.role'])

function toPositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function toNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

const CORE_RETENTION_DAYS = toPositiveNumber(process.env.AUDIT_LOGS_CORE_RETENTION_DAYS, 7)
const NON_CORE_RETENTION_HOURS = toPositiveNumber(process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS, 8)
const CORE_RETENTION_MS = CORE_RETENTION_DAYS * 24 * 60 * 60 * 1000
const NON_CORE_RETENTION_MS = NON_CORE_RETENTION_HOURS * 60 * 60 * 1000
// Rotation runs after every successful write; without a gate that means two
// DELETE statements per CRUD GET. Amortize to one rotation per interval per
// process — `0` opts back into rotate-on-every-write (test harnesses).
const ROTATE_INTERVAL_MS = toNonNegativeNumber(process.env.AUDIT_LOGS_ROTATE_INTERVAL_MS, 60_000)

let lastRotatedAt: number | null = null
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
// Postgres has a hard limit of 65k bind parameters per statement. Each access
// log row uses 10 bind values (see INSERT below), so 500 rows × 10 = 5 000
// parameters — well below the limit while keeping memory bounded.
const MAX_BATCH_ROWS = 500

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null

// Module-level registry of in-flight access-log writes. Both `log` and
// `logMany` opt every promise they kick off into this set so that
// `flushAccessLog()` can drain them. This is what makes the new
// fire-and-forget CRUD path safe for test code that asserts on `access_logs`
// rows immediately after a response — the integration harness defaults to
// blocking via `OM_CRUD_ACCESS_LOG_BLOCKING=1`, and direct callers can opt
// in to draining explicitly via `flushAccessLog()`.
const pendingAccessLogWrites = new Set<Promise<unknown>>()

function trackPendingAccessLogWrite<T>(promise: Promise<T>): Promise<T> {
  pendingAccessLogWrites.add(promise as unknown as Promise<unknown>)
  promise
    .catch(() => undefined)
    .finally(() => {
      pendingAccessLogWrites.delete(promise as unknown as Promise<unknown>)
    })
  return promise
}

export async function flushAccessLog(): Promise<void> {
  while (pendingAccessLogWrites.size > 0) {
    const snapshot = Array.from(pendingAccessLogWrites)
    await Promise.allSettled(snapshot)
  }
}

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

type RawEncryptedFields = {
  resourceKind?: unknown
  resourceId?: unknown
  accessType?: unknown
  fieldsJson?: unknown
  contextJson?: unknown
}

function serializeJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
      return value
    } catch {
      return JSON.stringify(value)
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export class AccessLogService {
  constructor(private readonly em: EntityManager) {}

  async log(input: AccessLogCreateInput): Promise<AccessLog | null> {
    const promise = this.logInternal(input)
    return trackPendingAccessLogWrite(promise)
  }

  async logMany(inputs: AccessLogCreateInput[]): Promise<number> {
    if (!Array.isArray(inputs) || inputs.length === 0) return 0
    const promise = this.logManyInternal(inputs)
    return trackPendingAccessLogWrite(promise)
  }

  flush(): Promise<void> {
    return flushAccessLog()
  }

  private async logManyInternal(inputs: AccessLogCreateInput[]): Promise<number> {
    // Parsing in parallel matches the legacy fan-out `Promise.all(map(...service.log()))`
    // path's wall-clock; the previous sequential loop made batched writes slower than
    // un-batched on tenants with encryption enabled and pushed UI integration tests
    // over their dialog-stability budget.
    const parsedResults = await Promise.all(inputs.map((input) => this.parseInput(input)))
    const normalized: AccessLogCreateInput[] = []
    for (const parsed of parsedResults) {
      if (parsed) normalized.push(parsed)
    }
    if (!normalized.length) return 0

    let written = 0
    for (let offset = 0; offset < normalized.length; offset += MAX_BATCH_ROWS) {
      const chunk = normalized.slice(offset, offset + MAX_BATCH_ROWS)
      written += await this.writeChunk(chunk)
    }
    if (written > 0) {
      const fork = this.em.fork({ useContext: true })
      await this.rotate(fork)
    }
    return written
  }

  private async writeChunk(chunk: AccessLogCreateInput[]): Promise<number> {
    if (!chunk.length) return 0
    const fork = this.em.fork({ useContext: true })
    const encryption = resolveTenantEncryptionService(fork as any)
    const createdAt = new Date()

    // Encrypt every row in parallel so encryption-enabled tenants do not pay
    // the N-rows × per-row latency penalty that the previous sequential
    // for-of loop introduced. The legacy `service.log()` fan-out resolved
    // its 50 encryption calls concurrently via `Promise.all`; preserve that
    // characteristic here so the batched single-INSERT path is strictly
    // faster than the legacy parallel-INSERTs path.
    type PreparedRow = {
      tenantId: string | null
      organizationId: string | null
      data: AccessLogCreateInput
      fields: unknown[] | null
      context: Record<string, unknown> | null
      encrypted: RawEncryptedFields | null
    }
    const prepared: PreparedRow[] = await Promise.all(
      chunk.map(async (data) => {
        const fields = Array.isArray(data.fields) && data.fields.length ? data.fields : null
        const context = data.context && Object.keys(data.context).length ? data.context : null
        const tenantId = data.tenantId ?? null
        const organizationId = data.organizationId ?? null
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
            )) as RawEncryptedFields)
          : null
        return { tenantId, organizationId, data, fields, context, encrypted }
      }),
    )

    const placeholders: string[] = []
    const params: unknown[] = []
    for (const row of prepared) {
      const { tenantId, organizationId, data, fields, context, encrypted } = row
      const resourceKindOut = encrypted?.resourceKind ?? data.resourceKind
      const resourceIdOut = encrypted?.resourceId ?? data.resourceId
      const accessTypeOut = encrypted?.accessType ?? data.accessType
      const fieldsOut = encrypted?.fieldsJson ?? fields
      const contextOut = encrypted?.contextJson ?? context
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      params.push(
        tenantId,
        organizationId,
        data.actorUserId ?? null,
        resourceKindOut,
        resourceIdOut,
        accessTypeOut,
        serializeJsonColumn(fieldsOut),
        serializeJsonColumn(contextOut),
        createdAt,
        null,
      )
    }
    if (!placeholders.length) return 0
    const sql = `insert into "access_logs" ("tenant_id", "organization_id", "actor_user_id", "resource_kind", "resource_id", "access_type", "fields_json", "context_json", "created_at", "deleted_at") values ${placeholders.join(', ')}`
    await fork.getConnection().execute(sql, params)
    return chunk.length
  }

  private async parseInput(input: AccessLogCreateInput): Promise<AccessLogCreateInput | null> {
    const schema = accessLogCreateSchema as typeof accessLogCreateSchema & { _zod?: unknown }
    const canValidate = Boolean(schema && typeof schema.parse === 'function')
    const shouldValidate = canValidate && runtimeValidationAvailable !== false
    if (shouldValidate) {
      try {
        const data = schema.parse(input)
        runtimeValidationAvailable = true
        return data
      } catch (err) {
        if (!isZodRuntimeMissing(err) && !validationWarningLogged) {
          validationWarningLogged = true
          // eslint-disable-next-line no-console
          console.warn('[audit_logs] falling back to permissive access log payload parser', err)
        }
        if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
        return this.normalizeInput(input)
      }
    }
    return this.normalizeInput(input)
  }

  private async logInternal(input: AccessLogCreateInput): Promise<AccessLog | null> {
    const data = await this.parseInput(input)
    if (!data) return null
    const fork = this.em.fork({ useContext: true })
    const fields = Array.isArray(data.fields) && data.fields.length ? data.fields : null
    const context = data.context && Object.keys(data.context).length ? data.context : null
    const createdAt = new Date()
    const tenantId = data.tenantId ?? null
    const organizationId = data.organizationId ?? null

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
        )) as RawEncryptedFields)
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
        serializeJsonColumn(payload.fieldsJson),
        serializeJsonColumn(payload.contextJson),
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
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    const toNullableUuid = (value: unknown) => {
      if (typeof value !== 'string' || value.length === 0) return null
      const candidate = value.startsWith('api_key:') ? value.slice('api_key:'.length) : value
      return UUID_REGEX.test(candidate) ? candidate : null
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

    // Encrypted jsonb columns (`fields_json`, `context_json`) come back as raw
    // JSON strings from the encryption subscriber after issue #1810 follow-up
    // (entity-field decryption no longer auto-parses). Restore the structured
    // shape on read so API consumers see typed objects/arrays.
    for (const item of items) {
      const rawFieldsJson = (item as { fieldsJson?: unknown }).fieldsJson
      if (typeof rawFieldsJson === 'string') {
        const parsed = parseDecryptedFieldValue(rawFieldsJson)
        item.fieldsJson = Array.isArray(parsed) ? (parsed as string[]) : null
      }
      const rawContextJson = (item as { contextJson?: unknown }).contextJson
      if (typeof rawContextJson === 'string') {
        const parsed = parseDecryptedFieldValue(rawContextJson)
        item.contextJson = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null
      }
    }

    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)))
    return { items, total, page, pageSize, totalPages }
  }

  private async rotate(fork: EntityManager) {
    const now = Date.now()
    if (ROTATE_INTERVAL_MS > 0 && lastRotatedAt !== null && now - lastRotatedAt < ROTATE_INTERVAL_MS) return
    lastRotatedAt = now
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
