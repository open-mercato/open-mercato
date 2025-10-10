import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudEntityIdentifiers,
  CrudEmitContext,
} from '../crud/types'

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
    values: Record<string, any>
    notify?: boolean // keep event emitting as it is via setCustomFields (updated)
  }): Promise<{ id: string }>

  updateCustomEntityRecord(opts: {
    entityId: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    values: Record<string, any>
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
  createOrmEntity<T = any>(opts: {
    entity: any
    data: Record<string, any>
  }): Promise<T>

  updateOrmEntity<T = any>(opts: {
    entity: any
    where: Record<string, any>
    apply: (current: T) => Promise<void> | void
  }): Promise<T | null>

  deleteOrmEntity<T = any>(opts: {
    entity: any
    where: Record<string, any>
    soft?: boolean
    softDeleteField?: string
  }): Promise<T | null>

  emitOrmEntityEvent<T = any>(opts: {
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
    await setRecordCustomFields(this.em, {
      entityId,
      recordId,
      organizationId,
      tenantId,
      values,
    })
    if (opts.notify !== false) {
      try {
        const bus = this.container.resolve<any>('eventBus')
        const [mod, ent] = (entityId || '').split(':')
        if (mod && ent) {
          await bus.emitEvent(`${mod}.${ent}.updated`, { id: recordId, organizationId, tenantId }, { persistent: true })
        }
      } catch {
        // non-blocking
      }
    }
  }

  private normalizeDocValues(values: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
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
    const knex = (this.em as any).getConnection().getKnex()
    const exists = await knex('information_schema.tables')
      .where({ table_name: 'custom_entities_storage' })
      .first()
    if (!exists) {
      throw new Error('custom_entities_storage table is missing. Run migrations (yarn db:migrate).')
    }
  }

  async createCustomEntityRecord(opts: Parameters<DataEngine['createCustomEntityRecord']>[0]): Promise<{ id: string }> {
    const knex = (this.em as any).getConnection().getKnex()
    await this.ensureStorageTableExists()
    const rawId = String(opts.recordId ?? '').trim()
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)
    const sentinel = rawId.toLowerCase()
    const shouldGenerate = !rawId || !isUuid || sentinel === 'create' || sentinel === 'new' || sentinel === 'null' || sentinel === 'undefined'
    try { console.log('[DataEngine.createCustomEntityRecord] recordId normalize', { rawId, isUuid, sentinel, shouldGenerate }) } catch {}
    const id = shouldGenerate ? ((): string => {
      const g: any = (globalThis as any)
      if (g?.crypto?.randomUUID) return g.crypto.randomUUID()
      // Fallback UUIDv4 generator
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    })() : rawId
    try { console.log('[DataEngine.createCustomEntityRecord] chosen id', id) } catch {}
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null
    const doc = { id, ...this.normalizeDocValues(opts.values || {}) }

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
    } catch (e) {
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
        try { console.error('[DataEngine] Failed to persist custom entity doc:', err) } catch {}
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
    const knex = (this.em as any).getConnection().getKnex()
    const id = String(opts.recordId)
    const orgId = opts.organizationId ?? null
    const tenantId = opts.tenantId ?? null

    // Merge doc shallowly: load existing doc and overlay
    await this.ensureStorageTableExists()
    const row = await knex('custom_entities_storage')
      .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
      .first()
    const prevDoc = row?.doc || { id }
    const nextDoc = { ...prevDoc, ...this.normalizeDocValues(opts.values || {}), id }
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
      console.error('[DataEngine] Failed to update custom entity doc:', err)
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
    const knex = (this.em as any).getConnection().getKnex()
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
      const values = await this.em.find((await import('@open-mercato/core/modules/entities/data/entities')).CustomFieldValue as any, {
        entityId: opts.entityId,
        recordId: id,
        organizationId: orgId,
        tenantId: opts.tenantId ?? null,
      } as any)
      const now = new Date()
      for (const r of values as any[]) r.deletedAt = r.deletedAt ?? now
      if (values.length) await this.em.persistAndFlush(values as any)
    } catch { /* non-blocking */ }
  }

  async createOrmEntity<T = any>(opts: Parameters<DataEngine['createOrmEntity']>[0]): Promise<T> {
    const repo = (this.em as any).getRepository(opts.entity)
    const entity = repo.create(opts.data)
    await this.em.persistAndFlush(entity)
    return entity as T
  }

  async updateOrmEntity<T = any>(opts: Parameters<DataEngine['updateOrmEntity']>[0]): Promise<T | null> {
    const repo = (this.em as any).getRepository(opts.entity)
    const current = await repo.findOne(opts.where)
    if (!current) return null
    await opts.apply(current)
    await this.em.persistAndFlush(current)
    return current as T
  }

  async deleteOrmEntity<T = any>(opts: Parameters<DataEngine['deleteOrmEntity']>[0]): Promise<T | null> {
    const repo = (this.em as any).getRepository(opts.entity)
    const current = await repo.findOne(opts.where)
    if (!current) return null
    if (opts.soft !== false) {
      const field = opts.softDeleteField || 'deletedAt'
      ;(current as any)[field] = new Date()
      await this.em.persistAndFlush(current)
    } else {
      await repo.removeAndFlush(current)
    }
    return current as T
  }

  async emitOrmEntityEvent<T = any>(opts: Parameters<DataEngine['emitOrmEntityEvent']>[0]): Promise<void> {
    const { action, entity, events, indexer, identifiers } = opts
    if (!events && !indexer) return
    if (!identifiers?.id) return

    let bus: any
    try {
      bus = this.container.resolve<any>('eventBus')
    } catch {
      bus = null
    }
    if (!bus) return

    const ctx: CrudEmitContext<T> = {
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
