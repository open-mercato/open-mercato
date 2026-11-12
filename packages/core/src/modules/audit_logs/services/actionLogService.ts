import { raw, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { z } from 'zod'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  actionLogCreateSchema,
  actionLogListSchema,
  uuid,
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
import {
  TenantDataEncryptionService,
  parseDecryptedFieldValue,
} from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { toOptionalString } from '@open-mercato/shared/lib/string/coerce'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY,
  actionLogBelongsToSubject,
  canonicalizeActorSubject,
} from '@open-mercato/core/modules/audit_logs/lib/actorSubject'
import {
  markAuditRedoUnavailable,
  redactSensitiveAuditData,
} from '@open-mercato/shared/lib/commands/audit-redaction'

const logger = createLogger('audit_logs').child({ component: 'action-log-service' })

const DEFAULT_LIST_PAGE_SIZE = 50

const actionLogListQuerySchema = actionLogListSchema.extend({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
})

type ParsedActionLogListQuery = z.infer<typeof actionLogListQuerySchema>

let validationWarningLogged = false
let runtimeValidationAvailable: boolean | null = null
let decryptionWarningLogged = false

const isZodRuntimeMissing = (err: unknown) => err instanceof TypeError && typeof err.message === 'string' && err.message.includes('_zod')

const SORT_FIELDS = {
  createdAt: 'action_logs.created_at',
} as const
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
// Mirrors what `uuid` (`data/validators.ts`) accepts — versions 1-8 plus the nil and
// max UUIDs — and is used only when the zod runtime is unavailable, so the actor
// sanitizer can never reject a value `actionLogCreateSchema` would have accepted.
export const SCHEMA_UUID_REGEX = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/
const SYSTEM_ACTOR_PREFIX = 'system:'
// `context.systemActor` names the automated principal behind an entry; `context.source`
// (read by `deriveActionLogSource`) names the channel it arrived through. They are
// siblings on purpose and never contradict each other: an entry carrying `systemActor`
// has a null actor column, which already derives the `system` source.
const SYSTEM_ACTOR_CONTEXT_KEY = 'systemActor'
const SYSTEM_ACTOR_REFERENCE_MAX_LENGTH = 255
const REPLAY_QUERY_BATCH_SIZE = 100
export const REPLAY_ENCRYPTED_SCAN_MAX_PAGES = 10

type ApiKeyReplayEntryKind = 'canonical' | 'legacy' | 'invalid'

function toNullableUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_REGEX.test(value) ? value : null
}

function isSchemaUuid(value: string): boolean {
  if (runtimeValidationAvailable === false) return SCHEMA_UUID_REGEX.test(value)

  try {
    return uuid.safeParse(value).success
  } catch (err) {
    if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
    return SCHEMA_UUID_REGEX.test(value)
  }
}

function readActorCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeActorUserId(value: unknown): string | null {
  const canonical = canonicalizeActorSubject(value)
  return canonical && isSchemaUuid(canonical.storageId) ? canonical.storageId : null
}

function toSystemActorReference(candidate: string): string | null {
  if (!candidate.startsWith(SYSTEM_ACTOR_PREFIX)) return null
  if (candidate.length === SYSTEM_ACTOR_PREFIX.length) return null
  return candidate.slice(0, SYSTEM_ACTOR_REFERENCE_MAX_LENGTH)
}

type ActionLogProjectionBackfillOptions = {
  batchSize?: number
  force?: boolean
  logger?: (message: string) => void
  organizationId?: string | null
  tenantId?: string | null
}

export type ActionLogSensitiveRedactionOptions = {
  batchSize?: number
  dryRun?: boolean
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

export type ActionLogSensitiveRedactionResult = {
  errors: number
  scanned: number
  skipped: number
  updated: number
  wouldUpdate: number
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

type SensitiveRedactionRow = {
  changes_json: unknown | null
  command_payload: unknown | null
  context_json: unknown | null
  created_at: Date
  id: string
  organization_id: string | null
  snapshot_after: unknown | null
  snapshot_before: unknown | null
  tenant_id: string | null
  undo_token: string | null
}

const SENSITIVE_AUDIT_STORAGE_FIELDS = [
  'command_payload',
  'snapshot_before',
  'snapshot_after',
  'changes_json',
  'context_json',
] as const

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

function isEncryptedAuditValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 4 && parts[3] === 'v1'
}

function containsEncryptedAuditValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (isEncryptedAuditValue(value)) return true
  if (!value || typeof value !== 'object' || value instanceof Date) return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some((item) => containsEncryptedAuditValue(item, seen))
  }
  return Object.values(value as Record<string, unknown>)
    .some((item) => containsEncryptedAuditValue(item, seen))
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sanitizeStoredAuditFields(row: SensitiveRedactionRow): {
  changesJson: unknown
  commandPayload: unknown
  contextJson: unknown
  redacted: boolean
  snapshotAfter: unknown
  snapshotBefore: unknown
} {
  const commandPayload = redactSensitiveAuditData(row.command_payload)
  const snapshotBefore = redactSensitiveAuditData(row.snapshot_before)
  const snapshotAfter = redactSensitiveAuditData(row.snapshot_after)
  const changesJson = redactSensitiveAuditData(row.changes_json)
  const contextJson = redactSensitiveAuditData(row.context_json)
  const redacted = commandPayload.redacted
    || snapshotBefore.redacted
    || snapshotAfter.redacted
    || changesJson.redacted
    || contextJson.redacted

  return {
    changesJson: changesJson.value,
    commandPayload: redacted
      ? markAuditRedoUnavailable(commandPayload.value)
      : commandPayload.value,
    contextJson: contextJson.value,
    redacted,
    snapshotAfter: snapshotAfter.value,
    snapshotBefore: snapshotBefore.value,
  }
}

function sanitizeActionLogInput(data: ActionLogCreateInput): ActionLogCreateInput {
  const commandPayload = redactSensitiveAuditData(data.commandPayload)
  const snapshotBefore = redactSensitiveAuditData(data.snapshotBefore)
  const snapshotAfter = redactSensitiveAuditData(data.snapshotAfter)
  const changes = redactSensitiveAuditData(data.changes)
  const context = redactSensitiveAuditData(data.context)
  const redacted = commandPayload.redacted
    || snapshotBefore.redacted
    || snapshotAfter.redacted
    || changes.redacted
    || context.redacted
  const sanitized: ActionLogCreateInput = {
    ...data,
    changes: changes.value,
    commandPayload: commandPayload.value,
    context: context.value,
    snapshotAfter: snapshotAfter.value,
    snapshotBefore: snapshotBefore.value,
  }

  if (redacted) {
    sanitized.undoToken = undefined
    sanitized.commandPayload = markAuditRedoUnavailable(sanitized.commandPayload)
  }

  return sanitized
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
          return parseDecryptedFieldValue(decrypted)
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
        { em: this.em },
      )

      const merged = {
        ...entry,
        ...decrypted,
      } as Record<string, unknown>

      // Audit log jsonb columns are encrypted as JSON-stringified payloads. After the
      // service-level `decryptEntityPayload` call (which now returns raw strings —
      // see issue #1810 follow-up), reattach the structured shape via
      // `parseDecryptedFieldValue` before running the recursive `deepDecrypt` walk
      // so nested encrypted strings inside payload objects/arrays are handled.
      const restoreJson = (value: unknown): unknown =>
        typeof value === 'string' ? parseDecryptedFieldValue(value) : value

      merged.changesJson = deepDecrypt(restoreJson(merged.changesJson ?? merged.changes_json ?? entry.changesJson ?? entry.changes_json))
      merged.changes_json = merged.changesJson
      merged.snapshotBefore = deepDecrypt(restoreJson(merged.snapshotBefore ?? merged.snapshot_before ?? entry.snapshotBefore ?? entry.snapshot_before))
      merged.snapshot_before = merged.snapshotBefore
      merged.snapshotAfter = deepDecrypt(restoreJson(merged.snapshotAfter ?? merged.snapshot_after ?? entry.snapshotAfter ?? entry.snapshot_after))
      merged.snapshot_after = merged.snapshotAfter
      merged.commandPayload = deepDecrypt(restoreJson(merged.commandPayload ?? merged.command_payload ?? entry.commandPayload ?? entry.command_payload))
      merged.command_payload = merged.commandPayload
      merged.contextJson = deepDecrypt(restoreJson(merged.contextJson ?? merged.context_json ?? entry.contextJson ?? entry.context_json))
      merged.context_json = merged.contextJson

      return merged as T
    } catch (err) {
      if (!decryptionWarningLogged) {
        decryptionWarningLogged = true
        logger.warn('Failed to decrypt action log entry', { err })
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

  private async decryptDetachedEntry(entry: ActionLog): Promise<ActionLog> {
    const detached = { ...(entry as unknown as Record<string, unknown>) }
    return await this.decryptEntryPayload(detached) as unknown as ActionLog
  }

  async log(input: ActionLogCreateInput, transactionalEm?: EntityManager): Promise<ActionLog | null> {
    const data = sanitizeActionLogInput(this.parseCreateInput(input))
    const operationEm = transactionalEm ?? this.em.fork()
    const log = this.createLogEntity(operationEm, data)
    await operationEm.persist(log).flush()
    if (transactionalEm) return this.decryptDetachedEntry(log)
    await this.decryptEntries(log)
    return log
  }

  private parseCreateInput(input: ActionLogCreateInput): ActionLogCreateInput {
    const sanitized = this.sanitizeActor(input)
    let data: ActionLogCreateInput
    const schema = actionLogCreateSchema as typeof actionLogCreateSchema & { _zod?: unknown }
    const canValidate = Boolean(schema && typeof schema.parse === 'function')
    const shouldValidate = canValidate && runtimeValidationAvailable !== false

    if (shouldValidate) {
      try {
        data = schema.parse(sanitized)
        runtimeValidationAvailable = true
      } catch (err) {
        if (!isZodRuntimeMissing(err) && !validationWarningLogged) {
          validationWarningLogged = true
          logger.warn('Falling back to permissive action log payload parser', { err })
        }
        if (isZodRuntimeMissing(err)) runtimeValidationAvailable = false
        data = this.normalizeInput(sanitized)
      }
    } else {
      data = this.normalizeInput(sanitized)
    }

    return data
  }

  private sanitizeActor(input: ActionLogCreateInput): ActionLogCreateInput {
    if (!input) return input
    const candidate = readActorCandidate(input.actorUserId)
    const actor = canonicalizeActorSubject(candidate)
    const actorUserId = actor?.storageId ?? null
    const systemActorReference = candidate && !actorUserId ? toSystemActorReference(candidate) : null

    if (actor) {
      const context = isRecord(input.context) ? { ...input.context } : {}
      context[ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY] = actor.subject
      return { ...input, actorUserId, context }
    }

    if (!systemActorReference) return { ...input, actorUserId: null }

    const context = isRecord(input.context) ? { ...input.context } : {}
    if (context[SYSTEM_ACTOR_CONTEXT_KEY] === undefined) {
      context[SYSTEM_ACTOR_CONTEXT_KEY] = systemActorReference
    }

    return { ...input, actorUserId, context }
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
      onBehalfOfUserId: data.onBehalfOfUserId ?? null,
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
        onBehalfOfUserId: null,
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
      actorUserId: normalizeActorUserId(input.actorUserId),
      onBehalfOfUserId: toNullableUuid(input.onBehalfOfUserId),
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
    return actionLogListQuerySchema.parse({
      ...query,
    })
  }

  private resolveActorUserIds(parsed: ParsedActionLogListQuery): string[] {
    const values = [...(parsed.actorUserIds ?? [])]
    if (parsed.actorUserId) values.push(parsed.actorUserId)

    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  }

  private resolveFieldNames(parsed: ParsedActionLogListQuery): string[] {
    const values = [...(parsed.fieldNames ?? [])]
    if (parsed.fieldName) values.push(parsed.fieldName)

    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
  }

  private resolveActionTypes(parsed: ParsedActionLogListQuery): ActionLogFilterType[] {
    const values = [...(parsed.actionTypes ?? [])]
    if (parsed.actionType) values.push(parsed.actionType)

    return Array.from(new Set(values))
      .filter((value): value is ActionLogFilterType => ACTION_LOG_FILTER_TYPES.includes(value as ActionLogFilterType))
  }

  private resolvePagination(parsed: ParsedActionLogListQuery): { page: number; pageSize: number; offset: number; limit: number } {
    const pageSize = parsed.pageSize ?? parsed.limit ?? DEFAULT_LIST_PAGE_SIZE
    const page = parsed.page ?? 1
    const offset = parsed.offset ?? (page - 1) * pageSize
    return { page, pageSize, offset, limit: pageSize }
  }

  private async loadEntries(parsed: ParsedActionLogListQuery, options?: { paginate?: boolean }) {
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
    const entries = ids
      .map((id: any) => byId.get(id))
      .filter((entry: any): entry is ActionLog => Boolean(entry))
    const apiKeyActor = parsed.actorSubject ? canonicalizeActorSubject(parsed.actorSubject) : null
    if (apiKeyActor?.kind !== 'api_key') return entries
    return entries.filter((entry: ActionLog) => (
      this.classifyApiKeyReplayEntry(entry, apiKeyActor.subject) !== 'invalid'
    ))
  }

  private buildListQuery(parsed: ParsedActionLogListQuery): any {
    let query = (this.em.getKysely<any>() as any)
      .selectFrom('action_logs')
      .selectAll()
      .where('action_logs.deleted_at', 'is', null) as any

    if (parsed.tenantId) query = query.where('action_logs.tenant_id', '=', parsed.tenantId)
    if (parsed.organizationId) query = query.where('action_logs.organization_id', '=', parsed.organizationId)

    if (parsed.actorSubject) {
      const actor = canonicalizeActorSubject(parsed.actorSubject)
      if (!actor) return query.where(sql<boolean>`false`)
      query = query.where('action_logs.actor_user_id', '=', actor.storageId)
      if (actor.kind === 'api_key') {
        query = query.where(sql<boolean>`(
          action_logs.context_json is null
          or jsonb_typeof(action_logs.context_json) = 'string'
          or (
            jsonb_typeof(action_logs.context_json) = 'object'
            and (
              not jsonb_exists(action_logs.context_json, ${ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY})
              or action_logs.context_json ->> ${ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY} = ${actor.subject}
            )
          )
        )`)
      }
    }

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

  private classifyApiKeyReplayEntry(entry: ActionLog, actorSubject: string): ApiKeyReplayEntryKind {
    if (entry.contextJson === null || entry.contextJson === undefined) return 'legacy'
    if (!isRecord(entry.contextJson)) return 'invalid'
    if (!Object.prototype.hasOwnProperty.call(entry.contextJson, ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY)) {
      return 'legacy'
    }
    return actionLogBelongsToSubject(entry, actorSubject) ? 'canonical' : 'invalid'
  }

  private async findLatestReplayEntry(
    actorUserId: string,
    filter: Record<string, unknown>,
    orderField: 'createdAt' | 'updatedAt',
  ): Promise<ActionLog | null> {
    const actor = canonicalizeActorSubject(actorUserId)
    if (!actor) return null
    const where: Record<string, unknown> = {
      actorUserId: actor.storageId,
      ...filter,
    }
    const orderBy = orderField === 'createdAt'
      ? { createdAt: 'desc' as const, id: 'desc' as const }
      : { updatedAt: 'desc' as const, id: 'desc' as const }

    if (actor.kind === 'user') {
      const entry = await this.em.findOne(ActionLog, where as FilterQuery<ActionLog>, { orderBy })
      await this.decryptEntries(entry)
      return entry
    }

    if (this.tenantEncryptionService?.isEnabled()) {
      let legacyEntry: ActionLog | null = null
      let cursor: { id: string; orderedAt: Date } | null = null
      for (let pageIndex = 0; ; pageIndex += 1) {
        if (pageIndex >= REPLAY_ENCRYPTED_SCAN_MAX_PAGES) {
          logger.warn('Stopped encrypted API-key replay scan at the page limit', {
            maxRows: REPLAY_ENCRYPTED_SCAN_MAX_PAGES * REPLAY_QUERY_BATCH_SIZE,
            hasLegacyFallback: legacyEntry !== null,
          })
          return legacyEntry
        }
        const pageWhere: Record<string, unknown> = cursor
          ? {
              $and: [
                where,
                {
                  $or: [
                    { [orderField]: { $lt: cursor.orderedAt } },
                    { [orderField]: cursor.orderedAt, id: { $lt: cursor.id } },
                  ],
                },
              ],
            }
          : where
        const entries: ActionLog[] = await this.em.find(ActionLog, pageWhere as FilterQuery<ActionLog>, {
          limit: REPLAY_QUERY_BATCH_SIZE,
          orderBy,
        })
        await this.decryptEntries(entries)
        for (const entry of entries) {
          const entryKind = this.classifyApiKeyReplayEntry(entry, actor.subject)
          if (entryKind === 'canonical') return entry
          if (entryKind === 'legacy' && !legacyEntry) legacyEntry = entry
        }
        if (entries.length < REPLAY_QUERY_BATCH_SIZE) return legacyEntry
        const lastEntry: ActionLog | undefined = entries.at(-1)
        if (!lastEntry) return legacyEntry
        cursor = {
          id: String(lastEntry.id),
          orderedAt: orderField === 'createdAt' ? lastEntry.createdAt : lastEntry.updatedAt,
        }
      }
    }

    const canonicalEntry = await this.em.findOne(ActionLog, {
      ...where,
      [raw(`"context_json" ->> '${ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY}'`)]: actor.subject,
    } as FilterQuery<ActionLog>, { orderBy })
    if (canonicalEntry) {
      await this.decryptEntries(canonicalEntry)
      return this.classifyApiKeyReplayEntry(canonicalEntry, actor.subject) === 'canonical'
        ? canonicalEntry
        : null
    }

    const legacyEntry = await this.em.findOne(ActionLog, {
      ...where,
      [raw(`("context_json" is null or (jsonb_typeof("context_json") = 'object' and not jsonb_exists("context_json", '${ACTION_LOG_ACTOR_SUBJECT_CONTEXT_KEY}')))`)]: true,
    } as FilterQuery<ActionLog>, { orderBy })
    await this.decryptEntries(legacyEntry)
    return legacyEntry && this.classifyApiKeyReplayEntry(legacyEntry, actor.subject) === 'legacy'
      ? legacyEntry
      : null
  }

  async latestUndoableForActor(actorUserId: string, scope: { tenantId?: string | null; organizationId?: string | null }) {
    const where: Record<string, unknown> = {
      undoToken: { $ne: null },
      executionState: 'done',
      deletedAt: null,
    }
    if (scope.tenantId) where.tenantId = scope.tenantId
    if (scope.organizationId) where.organizationId = scope.organizationId

    return this.findLatestReplayEntry(actorUserId, where, 'createdAt')
  }

  async claimForUndo(id: string, transactionalEm?: EntityManager): Promise<boolean> {
    const operationEm = transactionalEm ?? this.em
    const affected = await operationEm.nativeUpdate(
      ActionLog,
      { id, executionState: 'done', deletedAt: null },
      { executionState: 'undoing' },
    )
    return affected === 1
  }

  async releaseUndoClaim(id: string, transactionalEm?: EntityManager): Promise<boolean> {
    const operationEm = transactionalEm ?? this.em
    const affected = await operationEm.nativeUpdate(
      ActionLog,
      { id, executionState: 'undoing', deletedAt: null },
      { executionState: 'done' },
    )
    return affected === 1
  }

  async markUndone(id: string, traceInput?: ActionLogCreateInput, transactionalEm?: EntityManager) {
    const operationEm = transactionalEm ?? this.em.fork()
    const log = await operationEm.findOne(ActionLog, { id, deletedAt: null })
    if (!log) return null

    log.executionState = 'undone'
    log.undoToken = null

    const traceLog = traceInput ? this.createLogEntity(operationEm, this.parseCreateInput(traceInput)) : null
    if (traceLog) {
      operationEm.persist(traceLog)
    }

    await operationEm.flush()
    if (transactionalEm) return this.decryptDetachedEntry(log)
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
    const where: Record<string, unknown> = {
      undoToken: { $ne: null },
      executionState: 'done',
      deletedAt: null,
    }
    if (params.tenantId) where.tenantId = params.tenantId
    if (params.organizationId) where.organizationId = params.organizationId
    if (params.resourceKind) where.resourceKind = params.resourceKind
    if (params.resourceId) where.resourceId = params.resourceId

    return this.findLatestReplayEntry(params.actorUserId, where, 'createdAt')
  }

  async latestUndoneForActor(actorUserId: string, scope: { tenantId?: string | null; organizationId?: string | null }) {
    const where: Record<string, unknown> = {
      executionState: 'undone',
      deletedAt: null,
    }
    if (scope.tenantId) where.tenantId = scope.tenantId
    if (scope.organizationId) where.organizationId = scope.organizationId

    return this.findLatestReplayEntry(actorUserId, where, 'updatedAt')
  }

  async markRedone(id: string) {
    const operationEm = this.em.fork()
    const log = await operationEm.findOne(ActionLog, { id, deletedAt: null })
    if (!log) return null

    log.executionState = 'redone'
    log.undoToken = null
    await operationEm.flush()
    return log
  }

  /**
   * Compare-and-set the source of a redo from `undone` to its final `redone`
   * state. When supplied, `transactionalEm` is the same EntityManager used by
   * the replayed command and its new action log, so a later failure restores
   * the source row to `undone` automatically.
   */
  async claimForRedo(id: string, transactionalEm?: EntityManager): Promise<boolean> {
    const operationEm = transactionalEm ?? this.em
    const affected = await operationEm.nativeUpdate(
      ActionLog,
      { id, executionState: 'undone', deletedAt: null },
      { executionState: 'redone', undoToken: null },
    )
    return affected === 1
  }

  /**
   * Reverts a non-transactional `claimForRedo` after the replayed command failed,
   * so the source log stays redoable. Uses `transactionalEm` or an open request
   * transaction when the claim ran inside one; otherwise a fork, so a failed
   * command's request EntityManager state cannot block the compensation.
   */
  async releaseRedoClaim(id: string, transactionalEm?: EntityManager): Promise<boolean> {
    const operationEm = transactionalEm ?? (this.em.isInTransaction() ? this.em : this.em.fork())
    const affected = await operationEm.nativeUpdate(
      ActionLog,
      { id, executionState: 'redone', deletedAt: null },
      { executionState: 'undone' },
    )
    return affected === 1
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

  async redactSensitiveHistory(
    options: ActionLogSensitiveRedactionOptions = {},
  ): Promise<ActionLogSensitiveRedactionResult> {
    const batchSize = Math.min(Math.max(Math.trunc(options.batchSize ?? 250), 1), 1000)
    const report = options.logger ?? (() => {})
    const result: ActionLogSensitiveRedactionResult = {
      errors: 0,
      scanned: 0,
      skipped: 0,
      updated: 0,
      wouldUpdate: 0,
    }
    const connection = this.em.getConnection()
    let cursorCreatedAt: Date | null = null
    let cursorId: string | null = null

    while (true) {
      const conditions = ['deleted_at is null']
      const params: unknown[] = []
      if (options.tenantId) {
        conditions.push('tenant_id = ?')
        params.push(options.tenantId)
      }
      if (options.organizationId) {
        conditions.push('organization_id = ?')
        params.push(options.organizationId)
      }
      if (cursorCreatedAt && cursorId) {
        conditions.push('(created_at > ? or (created_at = ? and id > ?))')
        params.push(cursorCreatedAt, cursorCreatedAt, cursorId)
      }
      params.push(batchSize)

      const rows = await connection.execute<SensitiveRedactionRow[]>(
        `select id, tenant_id, organization_id, undo_token, command_payload,
                snapshot_before, snapshot_after, changes_json, context_json, created_at
           from action_logs
          where ${conditions.join(' and ')}
          order by created_at asc, id asc
          limit ?`,
        params,
      )
      if (rows.length === 0) break

      for (const row of rows) {
        result.scanned += 1
        try {
          const encryptedFields = new Set(
            await this.tenantEncryptionService?.getEncryptedFieldNames(
              'audit_logs:action_log',
              row.tenant_id,
              row.organization_id,
              { ignoreRuntimeHealth: true },
            ) ?? [],
          )
          const hasMappedEncryptedFields = SENSITIVE_AUDIT_STORAGE_FIELDS
            .some((field) => encryptedFields.has(field))
          if (hasMappedEncryptedFields && !this.tenantEncryptionService?.isEnabled()) {
            throw new Error('tenant encryption is required but unavailable')
          }

          const decrypted = await this.decryptEntryPayload(row as unknown as Record<string, unknown>)
          const decryptedRow: SensitiveRedactionRow = {
            ...row,
            changes_json: readValue(decrypted, 'changesJson', 'changes_json') ?? null,
            command_payload: readValue(decrypted, 'commandPayload', 'command_payload') ?? null,
            context_json: readValue(decrypted, 'contextJson', 'context_json') ?? null,
            snapshot_after: readValue(decrypted, 'snapshotAfter', 'snapshot_after') ?? null,
            snapshot_before: readValue(decrypted, 'snapshotBefore', 'snapshot_before') ?? null,
          }
          if (SENSITIVE_AUDIT_STORAGE_FIELDS.some((field) => containsEncryptedAuditValue(decryptedRow[field]))) {
            throw new Error('an encrypted audit field could not be decrypted')
          }

          const sanitized = sanitizeStoredAuditFields(decryptedRow)
          const changed = sanitized.redacted
            || !jsonValuesEqual(decryptedRow.command_payload, sanitized.commandPayload)
            || !jsonValuesEqual(decryptedRow.snapshot_before, sanitized.snapshotBefore)
            || !jsonValuesEqual(decryptedRow.snapshot_after, sanitized.snapshotAfter)
            || !jsonValuesEqual(decryptedRow.changes_json, sanitized.changesJson)
            || !jsonValuesEqual(decryptedRow.context_json, sanitized.contextJson)
          if (!changed) {
            result.skipped += 1
            continue
          }

          result.wouldUpdate += 1
          if (options.dryRun) continue

          let storagePayload: Record<string, unknown> = {
            changes_json: sanitized.changesJson,
            command_payload: sanitized.commandPayload,
            context_json: sanitized.contextJson,
            snapshot_after: sanitized.snapshotAfter,
            snapshot_before: sanitized.snapshotBefore,
          }
          if (hasMappedEncryptedFields && this.tenantEncryptionService) {
            storagePayload = await this.tenantEncryptionService.encryptEntityPayload(
              'audit_logs:action_log',
              storagePayload,
              row.tenant_id,
              row.organization_id,
            )
            for (const field of SENSITIVE_AUDIT_STORAGE_FIELDS) {
              if (!encryptedFields.has(field) || storagePayload[field] == null) continue
              if (!isEncryptedAuditValue(storagePayload[field])) {
                throw new Error(`audit field ${field} could not be re-encrypted`)
              }
            }
          }

          await connection.execute(
            `update action_logs
                set undo_token = null,
                    command_payload = ?::jsonb,
                    snapshot_before = ?::jsonb,
                    snapshot_after = ?::jsonb,
                    changes_json = ?::jsonb,
                    context_json = ?::jsonb,
                    updated_at = now()
              where id = ?`,
            [
              JSON.stringify(storagePayload.command_payload ?? null),
              JSON.stringify(storagePayload.snapshot_before ?? null),
              JSON.stringify(storagePayload.snapshot_after ?? null),
              JSON.stringify(storagePayload.changes_json ?? null),
              JSON.stringify(storagePayload.context_json ?? null),
              row.id,
            ],
          )
          result.updated += 1
        } catch (err) {
          result.errors += 1
          report(`[sensitive-data:redact] Failed for action log ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const lastRow = rows[rows.length - 1]
      cursorCreatedAt = lastRow.created_at
      cursorId = lastRow.id
      report(
        `[sensitive-data:redact] Processed ${result.scanned} action logs (updated: ${result.updated}, would update: ${result.wouldUpdate}, skipped: ${result.skipped}, errors: ${result.errors})`,
      )
      if (rows.length < batchSize) break
    }

    return result
  }
}
