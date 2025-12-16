import type { EntityMetadata, EventArgs, EventSubscriber } from '@mikro-orm/core'
import { ReferenceKind } from '@mikro-orm/core'
import { resolveEntityIdFromMetadata } from './entityIds'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from './toggles'
import { isEncryptionDebugEnabled } from './toggles'
import { resolveTenantEncryptionService } from './customFieldValues'

type Scoped = {
  tenantId?: string | null
  tenant_id?: string | null
  tenant?: { id?: string | null } | null
  organizationId?: string | null
  organization_id?: string | null
  organization?: { id?: string | null } | null
}

type Scope = { tenantId: string | null; organizationId: string | null }

function resolveScope(entity: Scoped): Scope {
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

const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()

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
    if (!entityId) {
      debug('⚠️ subscriber.decrypt.skip.entity_id_missing', {
        metaName: resolvedMeta?.className || resolvedMeta?.name,
        table: (resolvedMeta as any)?.tableName,
      })
      return
    }
    const { tenantId, organizationId } = resolveScope(target)
    if (!tenantId) {
      debug('⚪️ subscriber.skip', { reason: 'no-tenant', entityId })
      return
    }
    const encrypted = await this.service.encryptEntityPayload(entityId, target, tenantId, organizationId)
    const metaProps: Record<string, unknown> = resolvedMeta?.properties && typeof resolvedMeta.properties === 'object'
      ? resolvedMeta.properties
      : {}
    const payloadObj: Record<string, unknown> | null =
      changeSet && typeof changeSet === 'object'
        ? (typeof changeSet.payload === 'object' && changeSet.payload
            ? (changeSet.payload as Record<string, unknown>)
            : ((changeSet.payload = {}) as Record<string, unknown>))
        : null
    const updates: Record<string, unknown> = {}
    const columnNameFor = (propKey: string, prop: Record<string, unknown> | undefined): string => {
      try {
        if (prop && typeof prop === 'object') {
          const explicit = (prop as any)?.fieldName
          if (typeof explicit === 'string' && explicit.length) return explicit
          const name = (prop as any)?.name
          if (typeof name === 'string' && name.length) return name
        }
      } catch (err) {
        debug('⚠️ subscriber.column_name.resolve', {
          entityId,
          propKey,
          message: (err as Error)?.message ?? String(err),
        })
      }
      return toSnakeCase(propKey)
    }

    for (const [key, value] of Object.entries(encrypted)) {
      const prop = (metaProps as Record<string, any>)[key]
      if (!prop || typeof prop !== 'object') continue
      if ((target as Record<string, unknown>)[key] === value) continue
      updates[key] = value
    }
    if (Object.keys(updates).length === 0) return
    Object.assign(target, updates)
    if (payloadObj) {
      try {
        const ensureColumnKey = (propKey: string, value: unknown) => {
          const columnName = columnNameFor(propKey, (metaProps as Record<string, any>)[propKey])
          const canonicalKey = columnName || toSnakeCase(propKey)
          const aliases = new Set(
            [propKey, toSnakeCase(propKey), columnName, columnName ? toSnakeCase(columnName) : undefined].filter(
              (v): v is string => typeof v === 'string' && v.length > 0,
            ),
          )
          for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(payloadObj, alias)) delete payloadObj[alias]
          }
          const finalKey = columnName || toSnakeCase(propKey)
          payloadObj[finalKey] = value
        }
        for (const key of Object.keys(updates)) {
          ensureColumnKey(key, updates[key])
        }
      } catch (err) {
        debug('⚠️ subscriber.payload.normalize.error', {
          entityId,
          message: (err as Error)?.message ?? String(err),
        })
      }
    }
  }

  async decryptEntityGraph(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any; getComparator?: () => any },
    opts: { syncOriginal?: boolean; seen?: WeakSet<object>; fallbackScope?: Scope } = {},
  ) {
    await this.decrypt(target, meta, em, opts)
  }

  private async decrypt(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any; getComparator?: () => any },
    {
      syncOriginal = false,
      seen,
      fallbackScope,
    }: { syncOriginal?: boolean; seen?: WeakSet<object>; fallbackScope?: Scope } = {},
  ) {
    const visited = seen ?? new WeakSet<object>()
    if (visited.has(target as object)) return
    visited.add(target as object)
    if (!isTenantDataEncryptionEnabled() || !this.service.isEnabled()) {
      debug('⚪️ subscriber.skip', { reason: 'disabled', entity: meta?.className || meta?.name })
      return
    }
    const resolvedMeta = this.resolveMeta(meta, target, em)
    const entityId = this.resolveEntityId(resolvedMeta)
    if (!entityId) return
    const { tenantId, organizationId } = resolveScope(target)
    const scopedTenantId = tenantId ?? fallbackScope?.tenantId ?? null
    const scopedOrgId = organizationId ?? fallbackScope?.organizationId ?? null
    if (!scopedTenantId) {
      debug('⚪️ subscriber.skip', { reason: 'no-tenant', entityId })
      return
    }
    const decrypted = await this.service.decryptEntityPayload(entityId, target, scopedTenantId, scopedOrgId)
    Object.assign(target, decrypted)
    if (syncOriginal) {
      this.syncOriginalEntityData(target, resolvedMeta, em as any)
    }
    const nextFallback =
      fallbackScope ??
      (tenantId || organizationId
        ? { tenantId: tenantId ?? null, organizationId: organizationId ?? null }
        : { tenantId: scopedTenantId, organizationId: scopedOrgId })
    // Best-effort deep decrypt for loaded relations so populated graphs get cleaned too.
    try {
      const extractEntities = (value: any): any[] => {
        if (!value) return []
        // MikroORM Reference wrapper
        if (typeof value === 'object' && typeof (value as any).isInitialized === 'function') {
          try {
            if ((value as any).isInitialized()) {
              const unwrapped = typeof (value as any).unwrap === 'function' ? (value as any).unwrap() : (value as any).__entity ?? (value as any)
              if (unwrapped && typeof unwrapped === 'object') return [unwrapped]
            }
          } catch {
            // ignore
          }
          return []
        }
        // Collection wrapper
        if (typeof value === 'object' && typeof (value as any).isInitialized === 'function' && typeof (value as any).getItems === 'function') {
          try {
            return (value as any).isInitialized() ? (value as any).getItems() ?? [] : []
          } catch {
            return []
          }
        }
        if (Array.isArray(value)) return value
        if (typeof value === 'object') return [value]
        return []
      }
      const props = resolvedMeta?.properties ? Object.values(resolvedMeta.properties) : []
      for (const prop of props) {
        const kind = (prop as any)?.kind
        const name = (prop as any)?.name
        if (typeof name !== 'string' || !name.length) continue
        const value = (target as any)[name]
        if (!value) continue
        // Single-valued relation
        if ([ReferenceKind.MANY_TO_ONE, ReferenceKind.ONE_TO_ONE].includes(kind)) {
          const nestedEntities = extractEntities(value)
          for (const nested of nestedEntities) {
            const nestedMeta = this.resolveMeta((nested as any).__meta ?? (nested as any).__helper?.__meta, nested, em)
            await this.decrypt(nested as Record<string, unknown>, nestedMeta, em, {
              syncOriginal: true,
              seen: visited,
              fallbackScope: nextFallback,
            })
          }
          continue
        }
        // Collections
        if ([ReferenceKind.ONE_TO_MANY, ReferenceKind.MANY_TO_MANY].includes(kind)) {
          const items = extractEntities(value)
          for (const item of items) {
            if (!item || typeof item !== 'object') continue
            const nestedMeta = this.resolveMeta((item as any).__meta ?? (item as any).__helper?.__meta, item, em)
            await this.decrypt(item as Record<string, unknown>, nestedMeta, em, {
              syncOriginal: true,
              seen: visited,
              fallbackScope: nextFallback,
            })
          }
        }
      }
    } catch (err) {
      debug('⚠️ subscriber.deep_decrypt.error', {
        entityId,
        message: (err as Error)?.message ?? String(err),
      })
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

  async afterFind(args: EventArgs<any> & { entities?: unknown[] }) {
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

export async function decryptEntitiesWithFallbackScope(
  targets: unknown | unknown[],
  {
    em,
    tenantId,
    organizationId,
    encryptionService,
  }: {
    em: { getMetadata?: () => any; getComparator?: () => any }
    tenantId?: string | null
    organizationId?: string | null
    encryptionService?: TenantDataEncryptionService | null
  },
): Promise<void> {
  if (!isTenantDataEncryptionEnabled()) return
  const list = Array.isArray(targets) ? targets : [targets]
  if (!list.length) return
  const service = encryptionService ?? resolveTenantEncryptionService(em as any)
  if (!service || !service.isEnabled()) return
  const subscriber = new TenantEncryptionSubscriber(service)
  const fallback: Scope | undefined =
    tenantId || organizationId
      ? {
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
        }
      : undefined
  for (const entity of list) {
    if (!entity || typeof entity !== 'object') continue
    const meta = (entity as any).__meta ?? (entity as any).__helper?.__meta
    await subscriber.decryptEntityGraph(entity as Record<string, unknown>, meta, em as any, {
      syncOriginal: true,
      fallbackScope: fallback,
    })
  }
}
