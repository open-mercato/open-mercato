import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  actionLogCreateSchema,
  actionLogListSchema,
  type ActionLogCreateInput,
  type ActionLogListQuery,
} from '@open-mercato/core/modules/audit_logs/data/validators'
import { isRecord } from '@open-mercato/core/modules/audit_logs/lib/changeRows'
import {
  ACTION_LOG_FILTER_TYPES,
  type ActionLogFilterType,
  deriveActionLogProjection,
} from '@open-mercato/core/modules/audit_logs/lib/projections'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { toOptionalString } from '@open-mercato/shared/lib/string/coerce'

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null
let decryptionWarningLogged = false

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

const SORT_FIELDS = {
  createdAt: 'action_logs.created_at',
} as const
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

type ActionLogProjectionBackfillOptions = {
  batchSize?: number
  force?: boolean
  logger?: (message: string) => void
  organizationId?: string | null
  tenantId?: string | null
}

export type ActionLogProjectionBackfillResult = {
  errors: number
  scanned: number
  skipped: number
  updated: number
}

type BackfillRow = {
  action_label: string | null
  action_type: string | null
  actor_user_id: string | null
  changed_fields: string[] | null
  changes_json: Record<string, unknown> | null
  command_id: string
  context_json: Record<string, unknown> | null
  created_at: Date
  id: string
  organization_id: string | null
  primary_changed_field: string | null
  snapshot_before: unknown | null
  source_key: string | null
  tenant_id: string | null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return null
}

function readRecord(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key]
    if (isRecord(value)) return value
  }

  return null
}

function readValue(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  }

  return undefined
}

function readStringArray(record: Record<string, unknown>, ...keys: string[]): string[] | null {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string')
    }
  }

  return null
}

function stringArraysEqual(left: string[] | null, right: string[]): boolean {
  if (!Array.isArray(left)) return false
  if (left.length !== right.length) return false

  return left.every((value, index) => value === right[index])
}

export class ActionLogService {
  constructor(
    private readonly em: EntityManager,
    private readonly tenantEncryptionService?: TenantDataEncryptionService,
  ) {}

  private async decryptEntryPayload<T extends Record<string, unknown>>(entry: T): Promise<T> {
    if (!this.tenantEncryptionService?.isEnabled()) return entry

    try {
      const tenantId = readString(entry, 'tenantId', 'tenant_id')
      const organizationId = readString(entry, 'organizationId', 'organization_id')
      const dek = await this.tenantEncryptionService.getDek(tenantId)
      const deepDecrypt = (value: unknown): unknown => {
        if (!dek) return value
        if (typeof value === 'string' && value.split(':').length === 4 && value.endsWith(':v1')) {
          const decrypted = decryptWithAesGcm(value, dek.key)
          if (decrypted === null) return value
          try {
            return JSON.parse(decrypted)
          } catch {
            return decrypted
          }
        }
        if (Array.isArray(value)) return value.map((item) => deepDecrypt(item))
        if (value && typeof value === 'object') {
          const copy: Record<string, unknown> = {}
          for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            copy[key] = deepDecrypt(item)
          }
          return copy
        }
        return value
      }

      const decrypted = await this.tenantEncryptionService.decryptEntityPayload(
        'audit_logs:action_log',
        entry,
        tenantId,
        organizationId,
      )

      const merged = {
        ...entry,
        ...decrypted,
      } as Record<string, unknown>

      merged.changesJson = deepDecrypt(merged.changesJson ?? merged.changes_json ?? entry.changesJson ?? entry.changes_json)
      merged.changes_json = merged.changesJson
      merged.snapshotBefore = deepDecrypt(merged.snapshotBefore ?? merged.snapshot_before ?? entry.snapshotBefore ?? entry.snapshot_before)
      merged.snapshot_before = merged.snapshotBefore
      merged.snapshotAfter = deepDecrypt(merged.snapshotAfter ?? merged.snapshot_after ?? entry.snapshotAfter ?? entry.snapshot_after)
      merged.snapshot_after = merged.snapshotAfter
      merged.commandPayload = deepDecrypt(merged.commandPayload ?? merged.command_payload ?? entry.commandPayload ?? entry.command_payload)
      merged.command_payload = merged.commandPayload
      merged.contextJson = deepDecrypt(merged.contextJson ?? merged.context_json ?? entry.contextJson ?? entry.context_json)
      merged.context_json = merged.contextJson

      return merged as T
    } catch (err) {
      if (!decryptionWarningLogged) {
        decryptionWarningLogged = true
        console.warn('[audit_logs] failed to decrypt action log entry', err)
      }
      return entry
    }
  }

  private async decryptEntries(entries: ActionLog | ActionLog[] | null | undefined): Promise<void> {
    if (!entries) return

    const list = Array.isArray(entries) ? entries : [entries]
    for (const entry of list) {
      Object.assign(entry as unknown as Record<string, unknown>, await this.decryptEntryPayload(entry as unknown as Record<string, unknown>))
    }
  }

  async log(input: ActionLogCreateInput): Promise<ActionLog | null> {
    const data = this.parseCreateInput(input)
    const fork = this.em.fork()
    const log = this.createLogEntity(fork, data)
    await fork.persist(log).flush()
    await this.decryptEntries(log)
    return log
  }

  private parseCreateInput(input: ActionLogCreateInput): ActionLogCreateInput {
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
          console.warn('[audit_logs] falling back to permissive action log payload parser', err)
        }
        if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
        data = this.normalizeInput(input)
      }
    } else {
      data = this.normalizeInput(input)
    }

    return data
  }

  private createLogEntity(fork: EntityManager, data: ActionLogCreateInput): ActionLog {
    const projection = deriveActionLogProjection({
      actorUserId: data.actorUserId ?? null,
      actionLabel: data.actionLabel ?? null,
      changes: isRecord(data.changes) ? data.changes : null,
      commandId: data.commandId,
      context: isRecord(data.context) ? data.context : null,
      snapshotBefore: data.snapshotBefore,
    })

    return fork.create(ActionLog, {
      tenantId: data.tenantId ?? null,
      organizationId: data.organizationId ?? null,
      actorUserId: data.actorUserId ?? null,
      commandId: data.commandId,
      actionLabel: data.actionLabel ?? null,
      actionType: projection.actionType,
      resourceKind: data.resourceKind ?? null,
      resourceId: data.resourceId ?? null,
      parentResourceKind: data.parentResourceKind ?? null,
      parentResourceId: data.parentResourceId ?? null,
      relatedResourceKind: toOptionalString(data.relatedResourceKind) ?? null,
      relatedResourceId: toOptionalString(data.relatedResourceId) ?? null,
      executionState: data.executionState ?? 'done',
      undoToken: data.undoToken ?? null,
      commandPayload: data.commandPayload ?? null,
      snapshotBefore: data.snapshotBefore ?? null,
      snapshotAfter: data.snapshotAfter ?? null,
      changesJson: isRecord(data.changes) ? data.changes : null,
      changedFields: projection.changedFields,
      primaryChangedField: projection.primaryChangedField,
      contextJson: isRecord(data.context) ? data.context : null,
      sourceKey: projection.sourceKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
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
        relatedResourceKind: null,
        relatedResourceId: null,
        executionState: 'done',
        undoToken: undefined,
        commandPayload: undefined,
        snapshotBefore: undefined,
        snapshotAfter: undefined,
        changes: undefined,
        context: undefined,
      }
    }

    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    const toNullableUuid = (value: unknown) => {
      if (typeof value !== 'string' || value.length === 0) return null
      const candidate = value.startsWith('api_key:') ? value.slice('api_key:'.length) : value
      return UUID_REGEX.test(candidate) ? candidate : null
    }

    const normalizeRecordLike = (value: unknown): ActionLogCreateInput['changes'] => {
      if (value === null) return null
      if (Array.isArray(value)) return value
      if (typeof value === 'object') return value as Record<string, unknown>
      return undefined
    }

    const normalizeContext = (value: unknown) => (
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
    )

    return {
      tenantId: toNullableUuid(input.tenantId),
      organizationId: toNullableUuid(input.organizationId),
      actorUserId: toNullableUuid(input.actorUserId),
      commandId: typeof input.commandId === 'string' && input.commandId.length > 0 ? input.commandId : 'unknown',
      actionLabel: toOptionalString(input.actionLabel) ?? undefined,
      resourceKind: toOptionalString(input.resourceKind) ?? undefined,
      resourceId: toOptionalString(input.resourceId) ?? undefined,
      parentResourceKind: toOptionalString(input.parentResourceKind) ?? null,
      parentResourceId: toOptionalString(input.parentResourceId) ?? null,
      relatedResourceKind: toOptionalString(input.relatedResourceKind) ?? null,
      relatedResourceId: toOptionalString(input.relatedResourceId) ?? null,
      executionState: input.executionState === 'undone' || input.executionState === 'failed' ? input.executionState : 'done',
      undoToken: toOptionalString(input.undoToken) ?? undefined,
      commandPayload: input.commandPayload,
      snapshotBefore: input.snapshotBefore,
      snapshotAfter: input.snapshotAfter,
      changes: normalizeRecordLike(input.changes),
      context: normalizeContext(input.context),
    }
  }

  private parseListQuery(query: Partial<ActionLogListQuery>) {
    return actionLogListSchema.parse({
      ...query,
    })
  }

  private resolveActorUserIds(parsed: ActionLogListQuery): string[] {
    const values = [...(parsed.actorUserIds ?? [])]
    if (parsed.actorUserId) values.push(parsed.actorUserId)

    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  }

  private resolveFieldNames(parsed: ActionLogListQuery): string[] {
    const values = [...(parsed.fieldNames ?? [])]
    if (parsed.fieldName) values.push(parsed.fieldName)

    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  }

  private resolveActionTypes(parsed: ActionLogListQuery): ActionLogFilterType[] {
    const values = [...(parsed.actionTypes ?? [])]
    if (parsed.actionType) values.push(parsed.actionType)

    return Array.from(new Set(values))
      .filter((value): value is ActionLogFilterType => ACTION_LOG_FILTER_TYPES.includes(value as ActionLogFilterType))
  }

  private resolvePagination(parsed: ActionLogListQuery): { page: number; pageSize: number; offset: number; limit: number } {
    const pageSize =
      typeof parsed.pageSize === 'number' && parsed.pageSize > 0
        ? parsed.pageSize
        : typeof parsed.limit === 'number' && parsed.limit > 0
          ? parsed.limit
          : 50
    const page = typeof parsed.page === 'number' && parsed.page > 0 ? parsed.page : 1
    const offset =
      typeof parsed.offset === 'number' && parsed.offset >= 0
        ? parsed.offset
        : (page - 1) * pageSize
    return { page, pageSize, offset, limit: pageSize }
  }

  private async loadEntries(parsed: ActionLogListQuery, options?: { paginate?: boolean }) {
    let query = (this.buildListQuery(parsed) as any).select('action_logs.id as id')

    if (options?.paginate !== false) {
      const { limit, offset } = this.resolvePagination(parsed)
      query = query.limit(limit).offset(offset)
    }

    const rows = await query.execute()
    const ids = rows.map((row: any) => row.id).filter(Boolean)
    if (ids.length === 0) return []

    const results = await this.em.find(ActionLog, {
      id: { $in: ids } as any,
      deletedAt: null,
    })
    await this.decryptEntries(results)

    const byId = new Map(results.map((entry: any) => [entry.id, entry]))
    return ids
      .map((id: any) => byId.get(id))
      .filter((entry: any): entry is ActionLog => Boolean(entry))
  }

  private buildListQuery(parsed: ActionLogListQuery): any {
    let query = (this.em.getKysely<any>() as any)
      .selectFrom('action_logs')
      .selectAll()
      .where('action_logs.deleted_at', 'is', null) as any

    if (parsed.tenantId) query = query.where('action_logs.tenant_id', '=', parsed.tenantId)
    if (parsed.organizationId) query = query.where('action_logs.organization_id', '=', parsed.organizationId)

    const actorUserIds = this.resolveActorUserIds(parsed)
    if (actorUserIds.length === 1) query = query.where('action_logs.actor_user_id', '=', actorUserIds[0])
    if (actorUserIds.length > 1) query = query.where('action_logs.actor_user_id', 'in', actorUserIds)

    if (parsed.includeRelated && parsed.resourceKind && parsed.resourceId) {
      query = query.where((eb: any) =>
        eb.or([
          eb.and([
            eb('action_logs.resource_kind', '=', parsed.resourceKind),
            eb('action_logs.resource_id', '=', parsed.resourceId),
          ]),
          eb.and([
            eb('action_logs.parent_resource_kind', '=', parsed.resourceKind),
            eb('action_logs.parent_resource_id', '=', parsed.resourceId),
          ]),
          eb.and([
            eb('action_logs.related_resource_kind', '=', parsed.resourceKind),
            eb('action_logs.related_resource_id', '=', parsed.resourceId),
          ]),
        ])
      )
    } else {
      if (parsed.resourceKind) query = query.where('action_logs.resource_kind', '=', parsed.resourceKind)
      if (parsed.resourceId) query = query.where('action_logs.resource_id', '=', parsed.resourceId)
    }

    if (parsed.undoableOnly) query = query.where('action_logs.undo_token', 'is not', null)
    if (parsed.before) query = query.where('action_logs.created_at', '<', parsed.before)
    if (parsed.after) query = query.where('action_logs.created_at', '>', parsed.after)

    const fieldNames = this.resolveFieldNames(parsed)
    if (fieldNames.length === 1) query = query.where('action_logs.primary_changed_field', '=', fieldNames[0])
    if (fieldNames.length > 1) query = query.where('action_logs.primary_changed_field', 'in', fieldNames)

    const actionTypes = this.resolveActionTypes(parsed)
    if (actionTypes.length === 1) query = query.where('action_logs.action_type', '=', actionTypes[0])
    if (actionTypes.length > 1) query = query.where('action_logs.action_type', 'in', actionTypes)

    if (parsed.sortField === 'user') {
      query = query.leftJoin('users as audit_actor', 'audit_actor.id', 'action_logs.actor_user_id')
    }

    const sortDir = parsed.sortDir === 'asc' ? 'asc' : 'desc'
    switch (parsed.sortField) {
      case 'user':
        query = query.orderBy(sql`coalesce(nullif(audit_actor.name, ''), audit_actor.email, '')`, sortDir)
        break
      case 'action':
        query = query.orderBy(sql`coalesce(action_logs.action_type, '')`, sortDir)
        break
      case 'field':
        query = query.orderBy(sql`coalesce(action_logs.primary_changed_field, '')`, sortDir)
        break
      case 'source':
        query = query.orderBy(sql`coalesce(action_logs.source_key, '')`, sortDir)
        break
      case 'createdAt':
      default:
        query = query.orderBy(SORT_FIELDS.createdAt, sortDir)
        query = query.orderBy('action_logs.id', sortDir)
        return query
    }

    query = query.orderBy('action_logs.created_at', 'desc')
    query = query.orderBy('action_logs.id', 'desc')
    return query
  }

  async count(query: Partial<ActionLogListQuery>) {
    const parsed = this.parseListQuery(query)
    const row = await (this.buildListQuery(parsed) as any)
      .clearSelect()
      .clearOrderBy()
      .select(sql<string>`count(*)`.as('count'))
      .executeTakeFirst()

    if (!row) return 0
    const rawCount = row.count ?? 0
    return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount, 10) || 0
  }

  async list(query: Partial<ActionLogListQuery>) {
    const parsed = this.parseListQuery(query)
    const { page, pageSize } = this.resolvePagination(parsed)
    const [items, total] = await Promise.all([
      this.loadEntries(parsed),
      this.count(parsed),
    ])
    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)))
    return { items, total, page, pageSize, totalPages }
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

  async markUndone(id: string, traceInput?: ActionLogCreateInput) {
    const fork = this.em.fork()
    const log = await fork.findOne(ActionLog, { id, deletedAt: null })
    if (!log) return null

    log.executionState = 'undone'
    log.undoToken = null

    const traceLog = traceInput ? this.createLogEntity(fork, this.parseCreateInput(traceInput)) : null
    if (traceLog) {
      fork.persist(traceLog)
    }

    await fork.flush()
    await this.decryptEntries(log)
    if (traceLog) await this.decryptEntries(traceLog)

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

  async backfillProjections(options: ActionLogProjectionBackfillOptions = {}): Promise<ActionLogProjectionBackfillResult> {
    const batchSize = Math.min(Math.max(Math.trunc(options.batchSize ?? 250), 1), 1000)
    const logger = options.logger ?? (() => {})
    const result: ActionLogProjectionBackfillResult = {
      errors: 0,
      scanned: 0,
      skipped: 0,
      updated: 0,
    }

    let cursorCreatedAt: Date | null = null
    let cursorId: string | null = null

    while (true) {
      const rowsQuery = (this.em.getKysely<any>() as any)
        .selectFrom('action_logs')
        .select([
          'action_logs.id',
          'action_logs.tenant_id',
          'action_logs.organization_id',
          'action_logs.actor_user_id',
          'action_logs.command_id',
          'action_logs.action_label',
          'action_logs.snapshot_before',
          'action_logs.changes_json',
          'action_logs.context_json',
          'action_logs.action_type',
          'action_logs.source_key',
          'action_logs.changed_fields',
          'action_logs.primary_changed_field',
          'action_logs.created_at',
        ])
        .where('action_logs.deleted_at', 'is', null) as any

      if (options.tenantId) rowsQuery.where('action_logs.tenant_id', '=', options.tenantId)
      if (options.organizationId) rowsQuery.where('action_logs.organization_id', '=', options.organizationId)

      if (!options.force) {
        rowsQuery.where((eb: any) =>
          eb.or([
            eb('action_logs.action_type', 'is', null),
            eb('action_logs.source_key', 'is', null),
            eb('action_logs.changed_fields', 'is', null),
          ])
        )
      }

      if (cursorCreatedAt && cursorId) {
        rowsQuery.where((eb: any) =>
          eb.or([
            eb('action_logs.created_at', '>', cursorCreatedAt),
            eb.and([
              eb('action_logs.created_at', '=', cursorCreatedAt),
              eb('action_logs.id', '>', cursorId),
            ]),
          ])
        )
      }

      const rows = await rowsQuery
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .limit(batchSize)

      if (rows.length === 0) break

      for (const row of rows) {
        result.scanned += 1

        try {
          const decrypted = await this.decryptEntryPayload(row as unknown as Record<string, unknown>)
          const projection = deriveActionLogProjection({
            actorUserId: readString(decrypted, 'actorUserId', 'actor_user_id'),
            actionLabel: readString(decrypted, 'actionLabel', 'action_label'),
            changes: readRecord(decrypted, 'changesJson', 'changes_json'),
            commandId: readString(decrypted, 'commandId', 'command_id') ?? 'unknown',
            context: readRecord(decrypted, 'contextJson', 'context_json'),
            snapshotBefore: readValue(decrypted, 'snapshotBefore', 'snapshot_before'),
          })

          const needsUpdate = options.force === true
            || row.action_type !== projection.actionType
            || row.source_key !== projection.sourceKey
            || row.primary_changed_field !== projection.primaryChangedField
            || !stringArraysEqual(row.changed_fields, projection.changedFields)

          if (!needsUpdate) {
            result.skipped += 1
            continue
          }

          await (this.em.getKysely<any>() as any)
            .updateTable('action_logs')
            .set({
              action_type: projection.actionType,
              changed_fields: projection.changedFields,
              primary_changed_field: projection.primaryChangedField,
              source_key: projection.sourceKey,
            })
            .where('id', '=', row.id)
            .execute()

          result.updated += 1
        } catch (err) {
          result.errors += 1
          logger(`[backfill] Failed for action log ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const lastRow = rows[rows.length - 1]
      cursorCreatedAt = lastRow.created_at
      cursorId = lastRow.id

      logger(
        `[backfill] Processed ${result.scanned} action logs (updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors})`,
      )

      if (rows.length < batchSize) break
    }

    return result
  }
}
