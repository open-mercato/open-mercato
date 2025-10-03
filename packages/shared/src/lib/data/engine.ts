import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

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
      // Accept both 'cf_<key>' and 'cf:<key>' inputs and normalize to 'cf:<key>'
      if (k.startsWith('cf_')) out[`cf:${k.slice(3)}`] = v
      else out[k] = v
    }
    return out
  }

  async createCustomEntityRecord(opts: Parameters<DataEngine['createCustomEntityRecord']>[0]): Promise<{ id: string }> {
    const knex = (this.em as any).getConnection().getKnex()
    const id = opts.recordId && String(opts.recordId).length ? String(opts.recordId) : ((): string => {
      const g: any = (globalThis as any)
      if (g?.crypto?.randomUUID) return g.crypto.randomUUID()
      // Fallback UUIDv4 generator
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    })()
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
    } catch {
      // Fallback for global scope uniqueness
      const updated = await knex('custom_entities_storage')
        .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
        .update({ doc: payload.doc, updated_at: knex.fn.now(), deleted_at: null })
      if (!updated) {
        try { await knex('custom_entities_storage').insert(payload) } catch {}
      }
    }

    // Maintain EAV values for backward compatibility (+ event emission)
    if (opts.values && Object.keys(opts.values).length > 0) {
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
    const row = await knex('custom_entities_storage')
      .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
      .first()
    const prevDoc = row?.doc || { id }
    const nextDoc = { ...prevDoc, ...this.normalizeDocValues(opts.values || {}), id }
    await knex('custom_entities_storage')
      .where({ entity_type: opts.entityId, entity_id: id, organization_id: orgId })
      .update({ doc: nextDoc, updated_at: knex.fn.now(), deleted_at: null })

    // Maintain EAV values for backward compatibility (+ event emission)
    if (opts.values && Object.keys(opts.values).length > 0) {
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
}
