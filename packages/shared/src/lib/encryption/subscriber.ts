import type { EntityMetadata, EventArgs, EventSubscriber, FindEventArgs } from '@mikro-orm/core'
import { ReferenceKind } from '@mikro-orm/core'
import { resolveEntityIdFromMetadata } from './entityIds'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from './toggles'
import { isEncryptionDebugEnabled } from './toggles'

type Scoped = {
  tenantId?: string | null
  tenant_id?: string | null
  tenant?: { id?: string | null } | null
  organizationId?: string | null
  organization_id?: string | null
  organization?: { id?: string | null } | null
}

function resolveScope(entity: Scoped): { tenantId: string | null; organizationId: string | null } {
  const tenantId = entity.tenantId ?? entity.tenant_id ?? entity.tenant?.id ?? null
  const organizationId = entity.organizationId ?? entity.organization_id ?? entity.organization?.id ?? null
  return {
    tenantId: tenantId ? String(tenantId) : null,
    organizationId: organizationId ? String(organizationId) : null,
  }
}

function debug(event: string, payload: Record<string, unknown>) {
  if (!isEncryptionDebugEnabled()) return
  try {
    // eslint-disable-next-line no-console
    console.debug(event, payload)
  } catch {
    // ignore
  }
}

const registeredEventManagers = new WeakSet<object>()

export class TenantEncryptionSubscriber implements EventSubscriber<any> {
  constructor(private readonly service: TenantDataEncryptionService) {}

  getSubscribedEntities() {
    return [] // listen to all entities
  }

  private resolveMeta(
    meta: EntityMetadata<any> | undefined,
    entity: Record<string, unknown>,
    em?: { getMetadata?: () => any },
  ): EntityMetadata<any> | undefined {
    if (meta) return meta
    const ctor = (entity as any)?.constructor
    const name = ctor?.name
    const registry = em?.getMetadata?.()
    if (!registry || !name) return meta
    try { return registry.find?.(name) } catch {}
    try { return registry.find?.(ctor) } catch {}
    try { return registry.get?.(name) } catch {}
    try { return registry.get?.(ctor) } catch {}
    const all =
      (typeof registry.getAll === 'function' && registry.getAll()) ||
      (Array.isArray((registry as any).metadata) ? (registry as any).metadata : undefined) ||
      (registry as any).metadata ||
      {}
    try {
      const entries = Array.isArray(all) ? all : Object.values<any>(all)
      const match = entries.find(
        (m: any) =>
          m?.className === name ||
          m?.name === name ||
          m?.entityName === name ||
          m?.collection === ctor?.prototype?.__meta?.tableName ||
          m?.tableName === ctor?.prototype?.__meta?.tableName,
      )
      if (match) return match as EntityMetadata<any>
    } catch {
      // best-effort
    }
    return meta
  }

  private resolveEntityId(meta: EntityMetadata<any> | undefined): string | null {
    try {
      return resolveEntityIdFromMetadata(meta)
    } catch {
      return null
    }
  }

  private syncOriginalEntityData(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getComparator?: () => any },
  ) {
    const helper = (target as any)?.__helper
    if (!helper || typeof helper !== 'object') return

    // Prefer MikroORM comparator snapshot so change detection uses the expected shape.
    try {
      const comparator = em?.getComparator?.()
      if (comparator?.prepareEntity) {
        helper.__originalEntityData = comparator.prepareEntity(target)
        helper.__touched = false
        return
      }
    } catch (err) {
      debug('⚪️ subscriber.sync_original.comparator_failed', {
        entity: meta?.className || meta?.name,
        message: (err as Error)?.message ?? String(err),
      })
    }

    // Fallback: shallow snapshot of scalar/owner props to keep entities clean without comparator.
    const properties = meta?.properties ? Object.values(meta.properties) : []
    if (properties.length === 0) return
    const snapshot: Record<string, unknown> = { ...(helper.__originalEntityData ?? {}) }
    for (const prop of properties) {
      if ([ReferenceKind.ONE_TO_MANY, ReferenceKind.MANY_TO_MANY].includes((prop as any).kind)) continue
      const name = (prop as any).name
      if (typeof name !== 'string' || !name.length) continue
      snapshot[name] = (target as Record<string, unknown>)[name]
    }
    helper.__originalEntityData = snapshot
    helper.__touched = false
  }

  private async encrypt(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any; getComparator?: () => any },
    changeSet?: { payload?: Record<string, unknown> },
  ) {
    if (!isTenantDataEncryptionEnabled() || !this.service.isEnabled()) {
      debug('⚪️ subscriber.skip', { reason: 'disabled', entity: meta?.className || meta?.name })
      return
    }
    const resolvedMeta = this.resolveMeta(meta, target, em)
    const entityId = this.resolveEntityId(resolvedMeta)
    if (!entityId) return
    const { tenantId, organizationId } = resolveScope(target)
    if (!tenantId) {
      debug('⚪️ subscriber.skip', { reason: 'no-tenant', entityId })
      return
    }
    const encrypted = await this.service.encryptEntityPayload(entityId, target, tenantId, organizationId)
    const metaProps = resolvedMeta?.properties ?? {}
    const updates: Record<string, unknown> = {}
    const payloadUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(encrypted)) {
      const prop = (metaProps as Record<string, any>)[key]
      if (!prop || typeof prop !== 'object') continue
      if ((target as Record<string, unknown>)[key] === value) continue
      updates[key] = value
      const fieldNames = (prop as any)?.fieldNames
      const fieldName =
        (Array.isArray(fieldNames) && fieldNames.length ? fieldNames[0] : undefined) ??
        (typeof (prop as any)?.name === 'string' && (prop as any).name.length ? (prop as any).name : undefined) ??
        key
      if (typeof fieldName === 'string' && fieldName.length) {
        payloadUpdates[fieldName] = value
      }
    }
    if (Object.keys(updates).length === 0) return
    Object.assign(target, updates)
    if (changeSet?.payload && typeof changeSet.payload === 'object') {
      const payloadObj = changeSet.payload as Record<string, unknown>
      for (const key of Object.keys(updates)) {
        const prop = (metaProps as Record<string, any>)[key]
        const fieldNames = (prop as any)?.fieldNames
        const columnName =
          (Array.isArray(fieldNames) && fieldNames.length ? fieldNames[0] : undefined) ??
          (typeof (prop as any)?.name === 'string' && (prop as any).name.length ? (prop as any).name : undefined) ??
          key
        if (Object.prototype.hasOwnProperty.call(payloadObj, key)) delete payloadObj[key]
        if (columnName && Object.prototype.hasOwnProperty.call(payloadObj, columnName)) delete payloadObj[columnName]
        if (columnName) payloadObj[columnName] = updates[key]
      }
    }
  }

  private async decrypt(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any; getComparator?: () => any },
    { syncOriginal = false }: { syncOriginal?: boolean } = {},
  ) {
    if (!isTenantDataEncryptionEnabled() || !this.service.isEnabled()) {
      debug('⚪️ subscriber.skip', { reason: 'disabled', entity: meta?.className || meta?.name })
      return
    }
    const resolvedMeta = this.resolveMeta(meta, target, em)
    const entityId = this.resolveEntityId(resolvedMeta)
    if (!entityId) return
    const { tenantId, organizationId } = resolveScope(target)
    if (!tenantId) {
      debug('⚪️ subscriber.skip', { reason: 'no-tenant', entityId })
      return
    }
    const decrypted = await this.service.decryptEntityPayload(entityId, target, tenantId, organizationId)
    Object.assign(target, decrypted)
    if (syncOriginal) {
      this.syncOriginalEntityData(target, resolvedMeta, em as any)
    }
  }

  async beforeCreate(args: EventArgs<any>) {
    await this.encrypt(args.entity as Record<string, unknown>, args.meta, args.em, args.changeSet as any)
  }

  async beforeUpdate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
    await this.encrypt(args.entity as Record<string, unknown>, args.meta, args.em, args.changeSet as any)
  }

  async afterCreate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em, { syncOriginal: true })
  }

  async afterUpdate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em, { syncOriginal: true })
  }

  async afterUpsert(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em, { syncOriginal: true })
  }

  async onLoad(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em, { syncOriginal: true })
  }

  async afterFind(args: FindEventArgs<any>) {
    const entities = Array.isArray(args.entities) ? args.entities : []
    for (const entity of entities) {
      await this.decrypt(entity as Record<string, unknown>, args.meta, args.em, { syncOriginal: true })
    }
  }
}

export function registerTenantEncryptionSubscriber(
  em: { getEventManager?: () => { registerSubscriber?: (subscriber: EventSubscriber<any>) => void } } | null | undefined,
  service: TenantDataEncryptionService,
): void {
  const eventManager = em?.getEventManager?.()
  if (!eventManager || typeof eventManager.registerSubscriber !== 'function') return
  if (registeredEventManagers.has(eventManager)) return
  eventManager.registerSubscriber(new TenantEncryptionSubscriber(service))
  registeredEventManagers.add(eventManager)
}
