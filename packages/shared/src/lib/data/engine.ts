import type { EntityData, EntityName, FilterQuery } from '@mikro-orm/core'
import type { EntityManager, EntityRepository } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { validateCustomFieldValuesServer } from '@open-mercato/core/modules/entities/lib/validation'
import type { EventBus } from '@open-mercato/events/types'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudEntityIdentifiers,
} from '../crud/types'
import { CrudHttpError } from '../crud/errors'

type CustomEntityValues = Record<string, unknown>

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
  createOrmEntity<T>(opts: {
    entity: EntityName<T>
    data: EntityData<T>
  }): Promise<T>

  updateOrmEntity<T>(opts: {
    entity: EntityName<T>
    where: FilterQuery<T>
    apply: (current: T) => Promise<void> | void
  }): Promise<T | null>

  deleteOrmEntity<T>(opts: {
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
  }): Promise<void>
}

export class DefaultDataEngine implements DataEngine {
  constructor(private em: EntityManager, private container: AwilixContainer) {}

  async setCustomFields(opts: Parameters<DataEngine['setCustomFields']>[0]): Promise<void> {
    const { entityId, recordId, organizationId = null, tenantId = null, values } = opts
    await this.validateCustomFieldValues(entityId, organizationId, tenantId, values as Record<string, unknown>)
    await setRecordCustomFields(this.em, {
      entityId,
      recordId,
      organizationId,
      tenantId,
      values,
    })
    if (opts.notify !== false) {
      let bus: EventBus | null = null
      try {
        bus = this.container.resolve<EventBus>('eventBus')
      } catch {
        bus = null
      }
      if (bus) {
        const [mod, ent] = (entityId || '').split(':')
        if (mod && ent) {
          try {
            await bus.emitEvent(`${mod}.${ent}.updated`, { id: recordId, organizationId, tenantId }, { persistent: true })
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
      const v = String(process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM || '').toLowerCase().trim()
      return v === '1' || v === 'true' || v === 'yes'
    } catch { return false }
  }

  private async ensureStorageTableExists(): Promise<void> {
    const knex = this.em.getConnection().getKnex()
    const exists = await knex('information_schema.tables')
      .where({ table_name: 'custom_entities_storage' })
      .first()
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
    const knex = this.em.getConnection().getKnex()
    await this.ensureStorageTableExists()
    await this.validateCustomFieldValues(opts.entityId, opts.organizationId ?? null, opts.tenantId ?? null, opts.values)
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
    const doc: Record<string, unknown> = { id, ...this.normalizeDocValues(opts.values || {}) }

    const payload = {
      entity_type: opts.entityId,
      entity_id: id,
      organization_id: orgId,
      tenant_id: tenantId,
      doc,
      updated_at: knex.fn.now(),
      created_at: knex.fn.now(),
      deleted_at: null,
    }

    // Upsert by scoped uniqueness
    try {
      await knex('custom_entities_storage')
        .insert(payload)
        .onConflict(['entity_type', 'entity_id', 'organization_id'])
        .merge({ doc: payload.doc, updated_at: knex.fn.now(), deleted_at: null })
    } catch {
      // Fallback for global scope uniqueness
      try {
        const updated = await knex('custom_entities_storage')
          .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
          .update({ doc: payload.doc, updated_at: knex.fn.now(), deleted_at: null })
        if (!updated) {
          await knex('custom_entities_storage').insert(payload)
        }
      } catch (err) {
        // Surface a clear error so it doesn't silently fall back only to EAV
        throw err
      }
    }

    // Optional EAV backward compatibility (disabled by default)
    if (this.backcompatEavEnabled() && opts.values && Object.keys(opts.values).length > 0) {
      await this.setCustomFields({
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: tenantId,
        values: opts.values,
        notify: opts.notify, // defaults to true
      })
    }

    return { id }
  }

  async updateCustomEntityRecord(opts: Parameters<DataEngine['updateCustomEntityRecord']>[0]): Promise<void> {
    const knex = this.em.getConnection().getKnex()
    await this.validateCustomFieldValues(opts.entityId, opts.organizationId ?? null, opts.tenantId ?? null, opts.values)
    const id = String(opts.recordId)
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null

    // Merge doc shallowly: load existing doc and overlay
    await this.ensureStorageTableExists()
    const row = await knex('custom_entities_storage')
      .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
      .first()
    const prevDoc: Record<string, unknown> = row?.doc || { id }
    const nextDoc: Record<string, unknown> = { ...prevDoc, ...this.normalizeDocValues(opts.values || {}), id }
    try {
      const updated = await knex('custom_entities_storage')
        .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
        .update({ doc: nextDoc, updated_at: knex.fn.now(), deleted_at: null })
      if (!updated) {
        await knex('custom_entities_storage').insert({
          entity_type: opts.entityId,
          entity_id: id,
          organization_id: orgId,
          tenant_id: tenantId,
          doc: nextDoc,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
          deleted_at: null,
        })
      }
    } catch (err) {
      throw err
    }

    // Optional EAV backward compatibility (disabled by default)
    if (this.backcompatEavEnabled() && opts.values && Object.keys(opts.values).length > 0) {
      await this.setCustomFields({
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: tenantId,
        values: opts.values,
        notify: opts.notify, // defaults to true
      })
    }
  }

  async deleteCustomEntityRecord(opts: Parameters<DataEngine['deleteCustomEntityRecord']>[0]): Promise<void> {
    const knex = this.em.getConnection().getKnex()
    const id = String(opts.recordId)
    const orgId = opts.organizationId ?? null
    const soft = opts.soft !== false

    if (soft) {
      await knex('custom_entities_storage')
        .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
        .update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
    } else {
      await knex('custom_entities_storage')
        .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
        .delete()
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
      if (mutated.length) await this.em.persistAndFlush(values)
    } catch { /* non-blocking */ }
  }

  async createOrmEntity<T>(opts: { entity: EntityName<T>; data: EntityData<T> }): Promise<T> {
    const repo: EntityRepository<T> = this.em.getRepository(opts.entity)
    const entity = repo.create(opts.data)
    await this.em.persistAndFlush(entity)
    return entity
  }

  async updateOrmEntity<T>(opts: { entity: EntityName<T>; where: FilterQuery<T>; apply: (current: T) => Promise<void> | void }): Promise<T | null> {
    const repo: EntityRepository<T> = this.em.getRepository(opts.entity)
    const current = await repo.findOne(opts.where)
    if (!current) return null
    await opts.apply(current)
    await this.em.persistAndFlush(current)
    return current
  }

  async deleteOrmEntity<T>(opts: { entity: EntityName<T>; where: FilterQuery<T>; soft?: boolean; softDeleteField?: keyof T & string }): Promise<T | null> {
    const repo: EntityRepository<T> = this.em.getRepository(opts.entity)
    const current = await repo.findOne(opts.where)
    if (!current) return null
    if (opts.soft !== false) {
      const field = opts.softDeleteField || ('deletedAt' as keyof T & string)
      if (typeof current === 'object' && current !== null) {
        ;(current as Record<string, unknown>)[field] = new Date()
        await this.em.persistAndFlush(current)
      }
    } else {
      await this.em.removeAndFlush(current)
    }
    return current
  }

  async emitOrmEntityEvent<T>(opts: { action: CrudEventAction; entity: T; events?: CrudEventsConfig<T>; indexer?: CrudIndexerConfig<T>; identifiers: CrudEntityIdentifiers }): Promise<void> {
    const { action, entity, events, indexer, identifiers } = opts
    if (!events && !indexer) return
    if (!identifiers?.id) return

    let bus: EventBus | null = null
    try {
      bus = this.container.resolve<EventBus>('eventBus')
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
    }

    if (events) {
      const eventName = `${events.module}.${events.entity}.${action}`
      const payload = events.buildPayload
        ? events.buildPayload(ctx)
        : {
            id: ctx.identifiers.id,
            organizationId: ctx.identifiers.organizationId,
            tenantId: ctx.identifiers.tenantId,
          }
      try {
        await bus.emitEvent(eventName, payload, { persistent: !!events.persistent })
      } catch {
        // non-blocking
      }
    }

    if (indexer) {
      if (action === 'deleted') {
        const payload = indexer.buildDeletePayload
          ? indexer.buildDeletePayload(ctx)
          : {
              entityType: indexer.entityType,
              recordId: ctx.identifiers.id,
              organizationId: ctx.identifiers.organizationId,
              tenantId: ctx.identifiers.tenantId,
            }
        try {
          await bus.emitEvent('query_index.delete_one', payload)
        } catch {
          // non-blocking
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
        try {
          await bus.emitEvent('query_index.upsert_one', payload)
        } catch {
          // non-blocking
        }
      }
    }
  }
}
