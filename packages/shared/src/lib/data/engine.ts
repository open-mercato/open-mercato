import type { EntityData, EntityName, FilterQuery, RequiredEntityData } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { type Kysely, sql } from 'kysely'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { validateCustomFieldValuesServer } from '@open-mercato/core/modules/entities/lib/validation'
import { sanitizeCustomFieldHtmlRichTextValuesServer } from '@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer'
import type { EventBus } from '@open-mercato/events/types'
import {
  CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY,
  type CrudEventAction,
  type CrudEventsConfig,
  type CrudIndexerConfig,
  type CrudEntityIdentifiers,
} from '../crud/types'
import type { BulkImportSuppression } from '../commands/types'
import { CrudHttpError } from '../crud/errors'
import { resolveRegisteredEntityTableName } from '../query/engine'
import { getEntityIds } from '../encryption/entityIds'
import { normalizeCustomFieldValues } from '../custom-fields/normalize'
import { parseBooleanToken } from '../boolean'
import { isReadProjectionAlwaysConsistent } from './consistency'
import { isEventDeclared } from '../../modules/events'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'data-engine' })

const undeclaredEventWarned = new Set<string>()

function warnIfUndeclaredEvent(eventName: string, context: string): void {
  if (isEventDeclared(eventName)) return
  if (undeclaredEventWarned.has(eventName)) return
  undeclaredEventWarned.add(eventName)
  logger.warn('Emitting undeclared event — declare it in the owning module events.ts (createModuleEvents) so the event registry stays authoritative', { context, eventName })
}

/** Internal: clear the undeclared-event warning cache. Exposed for tests. */
export function __resetUndeclaredEventWarningsForTests(): void {
  undeclaredEventWarned.clear()
}

const COVERAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const coverageRefreshTracker = new Map<string, number>()

function shouldTriggerCoverageRefresh(entityType: string | undefined, tenantId: string | null): boolean {
  if (!entityType) return false
  const key = `${entityType}|${tenantId ?? '__null__'}`
  const now = Date.now()
  const last = coverageRefreshTracker.get(key) ?? 0
  if (now - last < COVERAGE_REFRESH_INTERVAL_MS) return false
  coverageRefreshTracker.set(key, now)
  return true
}

type CustomEntityValues = Record<string, unknown>

type QueuedCrudSideEffect = {
  action: CrudEventAction
  entity: unknown
  identifiers: CrudEntityIdentifiers
  syncOrigin?: string | null
  actorUserId?: string | null
  events?: CrudEventsConfig<unknown>
  indexer?: CrudIndexerConfig<unknown>
}

/**
 * A `makeCrudRoute` route-level `indexer:` declaration, handed to the data engine for the
 * duration of one command-bus write. Command handlers own the side-effect mark on the
 * `actions.*` path, and most of them mark `events:` only — without this the route's
 * declaration would reach no code at all. `entityClass` scopes the default to the route's
 * own ORM entity so a handler that also marks a sibling entity in the same request (a tag
 * assignment alongside a tag, say) is never indexed under the route's `entityType`.
 */
export type DefaultCrudIndexerConfig = {
  indexer: CrudIndexerConfig<unknown>
  entityClass: abstract new (...args: never[]) => object
}

export interface DataEngine {
  setCustomFields(opts: {
    entityId: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    values: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>>
    notify?: boolean // default true -> emit '<module>.<entity>.updated'
  }): Promise<void>

  // Storage for user-defined entities (doc-based)
  createCustomEntityRecord(opts: {
    entityId: string // '<module>:<entity>'
    recordId?: string // optional; auto-generate if not provided
    organizationId?: string | null
    tenantId?: string | null
    values: CustomEntityValues
    notify?: boolean // keep event emitting as it is via setCustomFields (updated)
  }): Promise<{ id: string }>

  updateCustomEntityRecord(opts: {
    entityId: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    values: CustomEntityValues
    notify?: boolean // keep event emitting as it is via setCustomFields (updated)
  }): Promise<void>

  deleteCustomEntityRecord(opts: {
    entityId: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    soft?: boolean // default true: sets deleted_at
    notify?: boolean // keep event emitting as it is (no extra events here)
  }): Promise<void>

  // Generic ORM-backed entity operations used by CrudFactory
  createOrmEntity<T extends object>(opts: {
    entity: EntityName<T>
    data: EntityData<T>
  }): Promise<T>

  updateOrmEntity<T extends object>(opts: {
    entity: EntityName<T>
    where: FilterQuery<T>
    apply: (current: T) => Promise<void> | void
  }): Promise<T | null>

  deleteOrmEntity<T extends object>(opts: {
    entity: EntityName<T>
    where: FilterQuery<T>
    soft?: boolean
    softDeleteField?: keyof T & string
  }): Promise<T | null>

  emitOrmEntityEvent<T>(opts: {
    action: CrudEventAction
    entity: T
    events?: CrudEventsConfig<T>
    indexer?: CrudIndexerConfig<T>
    identifiers: CrudEntityIdentifiers
    syncOrigin?: string | null
    actorUserId?: string | null
    /** Bulk-import deferral: skip the domain event and/or inline reindex for this emit. */
    suppress?: BulkImportSuppression
  }): Promise<void>

  markOrmEntityChange<T>(opts: {
    action: CrudEventAction
    entity: T | null | undefined
    events?: CrudEventsConfig<T>
    indexer?: CrudIndexerConfig<T>
    identifiers: CrudEntityIdentifiers
    syncOrigin?: string | null
    actorUserId?: string | null
  }): void

  /**
   * Drain queued side effects. When `suppress` is passed (a bulk-import backfill), the
   * flagged per-record events / reindex are skipped for every drained entry; the caller
   * is responsible for rebuilding the `query_index` afterwards.
   */
  flushOrmEntityChanges(suppress?: BulkImportSuppression): Promise<void>

  /**
   * Declare the indexer a CRUD route configured, for marks made during one command-bus
   * write that do not carry an indexer of their own. Pass `null` to clear it. Optional so
   * third-party `DataEngine` implementations stay valid; callers invoke it with `?.`.
   */
  setDefaultIndexerConfig?(config: DefaultCrudIndexerConfig | null): void

  /**
   * Whether any side effect drained since the current default was declared carried an
   * indexer for that default's entity class — false means the declared query-index
   * obligation was discharged by nobody. Optional for the same reason as the setter.
   */
  hasIndexedDefaultEntityClass?(): boolean
}

export const SYSTEM_ENTITY_RECORDS_BLOCKED_CODE = 'system_entity_records_blocked'

/**
 * A system entity for doc-storage purposes is an id that modules declare in the
 * generated entity-id registry AND that resolves to a registered ORM table. Both
 * conditions matter: `resolveRegisteredEntityTableName` matches class-name candidates
 * from the entity segment alone, so a runtime-registered custom entity whose name
 * happens to collide with some ORM class (e.g. `user:todo` vs the example module's
 * `Todo`) must never be classified as system. When the registry is not populated
 * (exotic bootstraps, unit harnesses) the check conservatively falls back to the
 * ORM-table match alone so the #2939 protection never switches off.
 */
export function isOrmBackedSystemEntityId(em: EntityManager, entityId: string): boolean {
  const registry = getEntityIds(false)
  const moduleIds = Object.values(registry).flatMap((moduleEntities) => Object.values(moduleEntities ?? {}))
  if (moduleIds.length > 0 && !moduleIds.includes(entityId)) return false
  return resolveRegisteredEntityTableName(em, entityId) !== null
}

/**
 * Doc storage (`custom_entities_storage`) is for custom entities only. A system
 * entity's records live in its own module tables/APIs — writing doc rows for it
 * poisons read-path classification (#2939) and must be rejected at the deepest
 * seam so no caller (API, AI tool, workflow) can do it.
 */
export function assertCustomEntityStorageEntityId(em: EntityManager, entityId: string): void {
  if (isOrmBackedSystemEntityId(em, entityId)) {
    throw new CrudHttpError(400, {
      error: 'Records are available for custom entities only',
      code: SYSTEM_ENTITY_RECORDS_BLOCKED_CODE,
      entityId,
    })
  }
}

export class DefaultDataEngine implements DataEngine {
  private pendingSideEffects = new Map<string, QueuedCrudSideEffect>()
  private defaultIndexer: DefaultCrudIndexerConfig | null = null
  private indexedDefaultEntityClass = false
  constructor(private em: EntityManager, private container: AwilixContainer) {}

  /**
   * Per-command state, deliberately held on the engine instance rather than threaded through
   * `CommandRuntimeContext` the way the bulk-import flags are. That is sound only because
   * `createRequestContainer()` registers `dataEngine` per request (`lib/di/container.ts`), so
   * one engine instance never spans two requests, and no `makeCrudRoute` verb runs two commands
   * concurrently against it. An application that re-registers `dataEngine` as a transient would
   * break both assumptions: the command would mark on a different instance than the route
   * declared on, so nothing is indexed and every write logs the undischarged-declaration warning.
   */
  setDefaultIndexerConfig(config: DefaultCrudIndexerConfig | null): void {
    this.defaultIndexer = config
    this.indexedDefaultEntityClass = false
  }

  hasIndexedDefaultEntityClass(): boolean {
    return this.indexedDefaultEntityClass
  }

  private matchesDefaultEntityClass(entity: unknown): boolean {
    const declared = this.defaultIndexer?.entityClass
    // `OrmEntityConfig.entity` is `any` and this repository treats `EntitySchema` instances as a
    // first-class entity shape (`lib/bootstrap/types.ts`). An `EntitySchema` is an object rather
    // than a constructor, so `instanceof` against it throws — and it would throw inside
    // `markOrmEntityChange`, outside the best-effort try/catch that guards the flush, turning
    // every write on such a route into a 500.
    if (typeof declared !== 'function') return false
    return entity instanceof declared
  }

  private resolveDefaultIndexer(entity: unknown): CrudIndexerConfig<unknown> | undefined {
    return this.matchesDefaultEntityClass(entity) ? this.defaultIndexer?.indexer : undefined
  }

  async setCustomFields(opts: Parameters<DataEngine['setCustomFields']>[0]): Promise<void> {
    const { entityId, recordId, organizationId = null, tenantId = null, values } = opts
    const sanitizedValues = await sanitizeCustomFieldHtmlRichTextValuesServer(this.em, {
      entityId,
      organizationId,
      tenantId,
      values,
    })
    await this.validateCustomFieldValues(entityId, organizationId, tenantId, sanitizedValues as Record<string, unknown>)
    let encryptionService: any = null
    try {
      encryptionService = this.container.resolve('tenantEncryptionService') as any
    } catch {
      encryptionService = null
    }
    await setRecordCustomFields(this.em, {
      entityId,
      recordId,
      organizationId,
      tenantId,
      values: sanitizedValues,
      encryptionService,
    })
    if (opts.notify !== false) {
      let bus: EventBus | null = null
      try {
        bus = (this.container.resolve('eventBus') as EventBus)
      } catch {
        bus = null
      }
      if (bus) {
        const [mod, ent] = (entityId || '').split(':')
        if (mod && ent) {
          const eventName = `${mod}.${ent}.updated`
          warnIfUndeclaredEvent(eventName, 'setCustomFields')
          try {
            await bus.emitEvent(eventName, { id: recordId, organizationId, tenantId }, {
              persistent: true,
              tenantId,
              organizationId,
              emitterModuleId: mod,
            })
          } catch {
            // non-blocking
          }
        }
      }
    }
  }

  private normalizeDocValues(values: CustomEntityValues): CustomEntityValues {
    const out: CustomEntityValues = {}
    for (const [k, v] of Object.entries(values || {})) {
      // Never allow callers to override reserved identifiers in the doc
      if (k === 'id' || k === 'entity_id' || k === 'entityId') continue
      // Accept both 'cf_<key>' and 'cf:<key>' inputs and normalize to 'cf:<key>'
      if (k.startsWith('cf_')) out[`cf:${k.slice(3)}`] = v
      else out[k] = v
    }
    return out
  }

  private backcompatEavEnabled(): boolean {
    try {
      return parseBooleanToken(process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM ?? '') === true
    } catch { return false }
  }

  private getKysely(): Kysely<any> {
    return this.em.getKysely<any>()
  }

  private async ensureStorageTableExists(): Promise<void> {
    const db = this.getKysely()
    const exists = await db
      .selectFrom('information_schema.tables' as any)
      .select(sql`1`.as('present'))
      .where('table_name' as any, '=', 'custom_entities_storage')
      .executeTakeFirst()
    if (!exists) {
      throw new Error('custom_entities_storage table is missing. Run migrations (yarn db:migrate).')
    }
  }

  private normalizeValuesForValidation(values: Record<string, unknown> | undefined | null): Record<string, unknown> {
    if (!values) return {}
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      if (key.startsWith('cf_') || key.startsWith('cf:')) {
        const normalized = key.slice(3)
        if (normalized) out[normalized] = value
        continue
      }
      out[key] = value
    }
    return out
  }

  private async validateCustomFieldValues(
    entityId: string,
    organizationId: string | null,
    tenantId: string | null,
    values: Record<string, unknown> | undefined | null,
  ): Promise<void> {
    const prepared = this.normalizeValuesForValidation(values)
    if (!entityId || Object.keys(prepared).length === 0) return
    const result = await validateCustomFieldValuesServer(this.em, {
      entityId,
      organizationId,
      tenantId,
      values: prepared,
    })
    if (!result.ok) {
      throw new CrudHttpError(400, { error: 'Validation failed', fields: result.fieldErrors })
    }
  }

  async createCustomEntityRecord(opts: Parameters<DataEngine['createCustomEntityRecord']>[0]): Promise<{ id: string }> {
    assertCustomEntityStorageEntityId(this.em, opts.entityId)
    const db = this.getKysely()
    await this.ensureStorageTableExists()
    const sanitizedValues = await sanitizeCustomFieldHtmlRichTextValuesServer(this.em, {
      entityId: opts.entityId,
      organizationId: opts.organizationId ?? null,
      tenantId: opts.tenantId ?? null,
      values: opts.values || {},
    })
    await this.validateCustomFieldValues(opts.entityId, opts.organizationId ?? null, opts.tenantId ?? null, sanitizedValues)
    const rawId = String(opts.recordId ?? '').trim()
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)
    const sentinel = rawId.toLowerCase()
    const shouldGenerate = !rawId || !isUuid || sentinel === 'create' || sentinel === 'new' || sentinel === 'null' || sentinel === 'undefined'
    const id = shouldGenerate ? ((): string => {
      const g = globalThis as { crypto?: { randomUUID?: () => string } }
      if (g.crypto?.randomUUID) return g.crypto.randomUUID()
      // Fallback UUIDv4 generator
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    })() : rawId
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null
    const doc: Record<string, unknown> = { id, ...this.normalizeDocValues(sanitizedValues || {}) }

    const now = sql`now()`
    const payload = {
      entity_type: opts.entityId,
      entity_id: id,
      organization_id: orgId,
      tenant_id: tenantId,
      doc: sql`${JSON.stringify(doc)}::jsonb`,
      updated_at: now,
      created_at: now,
      deleted_at: null,
    }

    // Upsert by scoped uniqueness
    try {
      await db
        .insertInto('custom_entities_storage' as any)
        .values(payload as any)
        .onConflict((oc) => oc
          .columns(['entity_type', 'entity_id', 'organization_id'])
          .doUpdateSet({
            doc: sql`${JSON.stringify(doc)}::jsonb`,
            updated_at: sql`now()`,
            deleted_at: null,
          } as any))
        .execute()
    } catch {
      // Fallback for global scope uniqueness
      try {
        const updated = await db
          .updateTable('custom_entities_storage' as any)
          .set({
            doc: sql`${JSON.stringify(doc)}::jsonb`,
            updated_at: sql`now()`,
            deleted_at: null,
          } as any)
          .where('entity_type' as any, '=', opts.entityId)
          .where('entity_id' as any, '=', id)
          .where('organization_id' as any, orgId === null ? 'is' : '=', orgId as any)
          .where('tenant_id' as any, tenantId === null ? 'is' : '=', tenantId as any)
          .executeTakeFirst()
        if (!updated || Number(updated.numUpdatedRows ?? 0) === 0) {
          await db.insertInto('custom_entities_storage' as any).values(payload as any).execute()
        }
      } catch (err) {
        // Surface a clear error so it doesn't silently fall back only to EAV
        throw err
      }
    }

    // Optional EAV backward compatibility (disabled by default)
    if (this.backcompatEavEnabled() && sanitizedValues && Object.keys(sanitizedValues).length > 0) {
      await this.setCustomFields({
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: tenantId,
        values: normalizeCustomFieldValues(sanitizedValues),
        notify: opts.notify, // defaults to true
      })
    }

    return { id }
  }

  async updateCustomEntityRecord(opts: Parameters<DataEngine['updateCustomEntityRecord']>[0]): Promise<void> {
    assertCustomEntityStorageEntityId(this.em, opts.entityId)
    const db = this.getKysely()
    const sanitizedValues = await sanitizeCustomFieldHtmlRichTextValuesServer(this.em, {
      entityId: opts.entityId,
      organizationId: opts.organizationId ?? null,
      tenantId: opts.tenantId ?? null,
      values: opts.values || {},
    })
    await this.validateCustomFieldValues(opts.entityId, opts.organizationId ?? null, opts.tenantId ?? null, sanitizedValues)
    const id = String(opts.recordId)
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null

    // Merge doc shallowly: load existing doc and overlay
    await this.ensureStorageTableExists()
    const applyScope = <T extends { where: (col: any, op: any, val?: any) => T }>(q: T) => {
      let chain = q.where('entity_type' as any, '=', opts.entityId)
      chain = chain.where('entity_id' as any, '=', id)
      chain = orgId === null
        ? chain.where('organization_id' as any, 'is', null as any)
        : chain.where('organization_id' as any, '=', orgId)
      chain = tenantId === null
        ? chain.where('tenant_id' as any, 'is', null as any)
        : chain.where('tenant_id' as any, '=', tenantId)
      return chain
    }
    const row = await applyScope(
      db.selectFrom('custom_entities_storage' as any).select(['doc' as any])
    ).executeTakeFirst()
    const prevDoc: Record<string, unknown> = (row as any)?.doc || { id }
    const nextDoc: Record<string, unknown> = { ...prevDoc, ...this.normalizeDocValues(sanitizedValues || {}), id }
    try {
      const updated = await applyScope(
        db.updateTable('custom_entities_storage' as any).set({
          doc: sql`${JSON.stringify(nextDoc)}::jsonb`,
          updated_at: sql`now()`,
          deleted_at: null,
        } as any) as any
      ).executeTakeFirst()
      if (!updated || Number((updated as any).numUpdatedRows ?? 0) === 0) {
        await db.insertInto('custom_entities_storage' as any).values({
          entity_type: opts.entityId,
          entity_id: id,
          organization_id: orgId,
          tenant_id: tenantId,
          doc: sql`${JSON.stringify(nextDoc)}::jsonb`,
          created_at: sql`now()`,
          updated_at: sql`now()`,
          deleted_at: null,
        } as any).execute()
      }
    } catch (err) {
      throw err
    }

    // Optional EAV backward compatibility (disabled by default)
    if (this.backcompatEavEnabled() && sanitizedValues && Object.keys(sanitizedValues).length > 0) {
      await this.setCustomFields({
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: tenantId,
        values: normalizeCustomFieldValues(sanitizedValues),
        notify: opts.notify, // defaults to true
      })
    }
  }

  async deleteCustomEntityRecord(opts: Parameters<DataEngine['deleteCustomEntityRecord']>[0]): Promise<void> {
    assertCustomEntityStorageEntityId(this.em, opts.entityId)
    const db = this.getKysely()
    const id = String(opts.recordId)
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null
    const soft = opts.soft !== false

    const applyScope = <T extends { where: (col: any, op: any, val?: any) => T }>(q: T) => {
      let chain = q.where('entity_type' as any, '=', opts.entityId)
      chain = chain.where('entity_id' as any, '=', id)
      chain = orgId === null
        ? chain.where('organization_id' as any, 'is', null as any)
        : chain.where('organization_id' as any, '=', orgId)
      chain = tenantId === null
        ? chain.where('tenant_id' as any, 'is', null as any)
        : chain.where('tenant_id' as any, '=', tenantId)
      return chain
    }

    if (soft) {
      await applyScope(
        db.updateTable('custom_entities_storage' as any).set({
          deleted_at: sql`now()`,
          updated_at: sql`now()`,
        } as any) as any
      ).execute()
    } else {
      await applyScope(db.deleteFrom('custom_entities_storage' as any) as any).execute()
    }

    // Soft-delete EAV values to preserve current behavior
    try {
      const { CustomFieldValue } = await import('@open-mercato/core/modules/entities/data/entities')
      const values = await this.em.find(CustomFieldValue, {
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: opts.tenantId ?? null,
      })
      const now = new Date()
      const mutated = values.filter((record) => {
        if (record.deletedAt) return false
        record.deletedAt = now
        return true
      })
      if (mutated.length) {
        for (const record of values) this.em.persist(record)
        await this.em.flush()
      }
    } catch { /* non-blocking */ }
  }

  async createOrmEntity<T extends object>(opts: { entity: EntityName<T>; data: EntityData<T> }): Promise<T> {
    const entity = this.em.create(
      opts.entity as EntityName<T>,
      opts.data as unknown as RequiredEntityData<T>
    )
    await this.em.persist(entity).flush()
    return entity
  }

  async updateOrmEntity<T extends object>(opts: {
    entity: EntityName<T>
    where: FilterQuery<T>
    apply: (current: T) => Promise<void> | void
  }): Promise<T | null> {
    const current = await this.em.findOne(opts.entity as EntityName<T>, opts.where as FilterQuery<NoInfer<T>>)
    if (!current) return null
    await opts.apply(current)
    await this.em.persist(current).flush()
    return current
  }

  async deleteOrmEntity<T extends object>(opts: {
    entity: EntityName<T>
    where: FilterQuery<T>
    soft?: boolean
    softDeleteField?: keyof T & string
  }): Promise<T | null> {
    const current = await this.em.findOne(opts.entity as EntityName<T>, opts.where as FilterQuery<NoInfer<T>>)
    if (!current) return null
    if (opts.soft !== false) {
      const field = opts.softDeleteField || ('deletedAt' as keyof T & string)
      if (typeof current === 'object' && current !== null) {
        ;(current as Record<string, unknown>)[field] = new Date()
        await this.em.persist(current).flush()
      }
    } else {
      await this.em.remove(current).flush()
    }
    return current
  }

  async emitOrmEntityEvent<T>(opts: {
    action: CrudEventAction
    entity: T
    events?: CrudEventsConfig<T>
    indexer?: CrudIndexerConfig<T>
    identifiers: CrudEntityIdentifiers
    syncOrigin?: string | null
    actorUserId?: string | null
    suppress?: BulkImportSuppression
  }): Promise<void> {
    const { action, entity, events, indexer, identifiers, syncOrigin, suppress } = opts
    // Bulk-import deferral: an entry may suppress its domain event and/or inline reindex. When both
    // the config is absent AND (for the present one) suppressed, there is nothing left to do.
    const emitEvents = !!events && !suppress?.skipEvents
    const runIndexer = !!indexer && !suppress?.skipReindex
    if (!emitEvents && !runIndexer) return
    if (!identifiers?.id) return

    let bus: EventBus | null = null
    try {
      bus = (this.container.resolve('eventBus') as EventBus)
    } catch {
      bus = null
    }
    if (!bus) return

    const ctx = {
      action,
      entity,
      identifiers: {
        id: identifiers.id,
        organizationId: identifiers.organizationId ?? null,
        tenantId: identifiers.tenantId ?? null,
      },
      syncOrigin: syncOrigin ?? null,
      actorUserId: opts.actorUserId ?? null,
    }

    if (events && !suppress?.skipEvents) {
      const eventName = `${events.module}.${events.entity}.${action}`
      warnIfUndeclaredEvent(eventName, 'emitOrmEntityEvent')
      const builtPayload = events.buildPayload
        ? events.buildPayload(ctx)
        : {
            id: ctx.identifiers.id,
            organizationId: ctx.identifiers.organizationId,
            tenantId: ctx.identifiers.tenantId,
            ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
          }
      // A configured indexer means this data-engine call owns the query-index
      // decision, including an explicit skipReindex suppression. Mark object
      // payloads so the legacy domain-event bridge does not enqueue the same
      // record a second time. Keep the marker non-enumerable so client broadcasts
      // and persisted domain payloads retain their existing public shape.
      // Primitive custom payloads cannot be bridged in any case because they do
      // not expose the record id.
      const payload = indexer && builtPayload && typeof builtPayload === 'object' && !Array.isArray(builtPayload)
        ? Object.defineProperty(
            { ...(builtPayload as Record<string, unknown>) },
            CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY,
            { value: true, enumerable: false },
          )
        : builtPayload
      try {
        await bus.emitEvent(eventName, payload, {
          persistent: !!events.persistent,
          tenantId: ctx.identifiers.tenantId ?? null,
          organizationId: ctx.identifiers.organizationId ?? null,
          emitterModuleId: events.module,
        })
      } catch {
        // non-blocking
      }
    }

    if (indexer && !suppress?.skipReindex) {
      const alwaysConsistent = isReadProjectionAlwaysConsistent()
      const resolveCoverageBaseDelta = (): number | undefined => {
        if (action === 'created') return 1
        if (action === 'deleted') return -1
        return undefined
      }
      const coverageBaseDelta = resolveCoverageBaseDelta()

      if (action === 'deleted') {
        const payload = indexer.buildDeletePayload
          ? indexer.buildDeletePayload(ctx)
          : {
              entityType: indexer.entityType,
              recordId: ctx.identifiers.id,
              organizationId: ctx.identifiers.organizationId,
              tenantId: ctx.identifiers.tenantId,
            }
        const enrichedPayload = payload as Record<string, unknown>
        enrichedPayload.crudAction = action
        if (coverageBaseDelta !== undefined) enrichedPayload.coverageBaseDelta = coverageBaseDelta
        if (ctx.syncOrigin) enrichedPayload.syncOrigin = ctx.syncOrigin
        // Await the index update so query-index reads (the `customValues`/scalar
        // projection that list endpoints serve) are consistent the moment the write
        // returns. The subscriber removes the projection row + tokens synchronously and
        // defers the coverage recompute + fulltext delete, so this stays bounded.
        // Errors are logged, not thrown — index drift never fails the originating write.
        // Always-consistent mode rethrows so drift is loud and retryable.
        if (alwaysConsistent) {
          await bus.emitEvent('query_index.delete_one', enrichedPayload, { rethrowHandlerErrors: true })
        } else {
          await bus.emitEvent('query_index.delete_one', enrichedPayload).catch((err: unknown) => {
            logger.error('query_index.delete_one emit failed', { err })
          })
        }
      } else {
        const payload = indexer.buildUpsertPayload
          ? indexer.buildUpsertPayload(ctx)
          : {
              entityType: indexer.entityType,
              recordId: ctx.identifiers.id,
              organizationId: ctx.identifiers.organizationId,
              tenantId: ctx.identifiers.tenantId,
            }
        const enrichedPayload = payload as Record<string, unknown>
        enrichedPayload.crudAction = action
        if (coverageBaseDelta !== undefined) enrichedPayload.coverageBaseDelta = coverageBaseDelta
        if (ctx.syncOrigin) enrichedPayload.syncOrigin = ctx.syncOrigin
        // Await the projection upsert so list reads observe the new doc immediately
        // (see delete_one above). The subscriber updates `entity_indexes` synchronously
        // and defers the heavy token-reindex pipeline (build doc + encrypt + decrypt +
        // tokenize + DELETE + chunked INSERT) so write latency stays bounded.
        if (alwaysConsistent) {
          await bus.emitEvent('query_index.upsert_one', enrichedPayload, { rethrowHandlerErrors: true })
        } else {
          await bus.emitEvent('query_index.upsert_one', enrichedPayload).catch((err: unknown) => {
            logger.error('query_index.upsert_one emit failed', { err })
          })
        }
      }

      if (alwaysConsistent || shouldTriggerCoverageRefresh(indexer.entityType, ctx.identifiers.tenantId ?? null)) {
        const coveragePayload = {
          entityType: indexer.entityType,
          tenantId: ctx.identifiers.tenantId ?? null,
          organizationId: null,
          delayMs: 0,
        }
        if (alwaysConsistent) {
          await bus.emitEvent('query_index.coverage.refresh', coveragePayload, { rethrowHandlerErrors: true })
        } else {
          void bus.emitEvent('query_index.coverage.refresh', coveragePayload).catch(() => undefined)
        }
      }
    }
  }

  markOrmEntityChange<T>(opts: {
    action: CrudEventAction
    entity: T | null | undefined
    events?: CrudEventsConfig<T>
    indexer?: CrudIndexerConfig<T>
    identifiers: CrudEntityIdentifiers
    syncOrigin?: string | null
    actorUserId?: string | null
  }): void {
    const { entity, identifiers } = opts
    if (!entity) return
    if (!identifiers?.id) return
    // A command handler that marks `events:` only still discharges the route's declared
    // query-index obligation — the route hands its `indexer:` down as the default so the
    // handler's own entity and identifiers (the accurate ones) drive the projection write.
    const indexer = opts.indexer ?? this.resolveDefaultIndexer(entity)
    const key = this.buildSideEffectKey(opts.action, identifiers)
    const existing = this.pendingSideEffects.get(key)
    if (existing) {
      existing.entity = entity
      existing.identifiers = {
        id: identifiers.id,
        organizationId: identifiers.organizationId ?? null,
        tenantId: identifiers.tenantId ?? null,
      }
      existing.syncOrigin = opts.syncOrigin ?? null
      existing.actorUserId = opts.actorUserId ?? null
      if (opts.events) existing.events = opts.events as CrudEventsConfig<unknown>
      // Explicit always wins, on the merge branch too: a second `events:`-only mark on the same
      // key must not let the route default overwrite the `indexer:` an earlier mark installed,
      // which would silently drop that handler's own `buildUpsertPayload`.
      if (opts.indexer) existing.indexer = opts.indexer as CrudIndexerConfig<unknown>
      else if (!existing.indexer && indexer) existing.indexer = indexer
      this.pendingSideEffects.set(key, existing)
      return
    }
    const entry: QueuedCrudSideEffect = {
      action: opts.action,
      entity,
      identifiers: {
        id: identifiers.id,
        organizationId: identifiers.organizationId ?? null,
        tenantId: identifiers.tenantId ?? null,
      },
      syncOrigin: opts.syncOrigin ?? null,
      actorUserId: opts.actorUserId ?? null,
    }
    if (opts.events) entry.events = opts.events as CrudEventsConfig<unknown>
    if (indexer) entry.indexer = indexer
    this.pendingSideEffects.set(key, entry)
  }

  async flushOrmEntityChanges(suppress?: BulkImportSuppression): Promise<void> {
    if (!this.pendingSideEffects.size) return
    const entries = Array.from(this.pendingSideEffects.values())
    this.pendingSideEffects.clear()
    for (const entry of entries) {
      if (entry.indexer && !suppress?.skipReindex && this.matchesDefaultEntityClass(entry.entity)) {
        this.indexedDefaultEntityClass = true
      }
      try {
        await this.emitOrmEntityEvent({
          action: entry.action,
          entity: entry.entity,
          identifiers: entry.identifiers,
          syncOrigin: entry.syncOrigin ?? null,
          actorUserId: entry.actorUserId ?? null,
          events: entry.events as CrudEventsConfig<unknown>,
          indexer: entry.indexer as CrudIndexerConfig<unknown>,
          suppress,
        })
      } catch (error) {
        if (isReadProjectionAlwaysConsistent()) {
          throw error
        }
        // best-effort; continue with remaining side effects
      }
    }
  }

  private buildSideEffectKey(action: CrudEventAction, identifiers: CrudEntityIdentifiers): string {
    const id = identifiers.id ?? ''
    const org = identifiers.organizationId ?? ''
    const tenant = identifiers.tenantId ?? ''
    return [action, id, org, tenant].join('|')
  }
}
