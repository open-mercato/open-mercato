import type { EntityMetadata, EventArgs, EventSubscriber } from '@mikro-orm/core'
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

  private async encrypt(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any },
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
    Object.assign(target, encrypted)
  }

  private async decrypt(
    target: Record<string, unknown>,
    meta: EntityMetadata<any> | undefined,
    em?: { getMetadata?: () => any },
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
  }

  async beforeCreate(args: EventArgs<any>) {
    await this.encrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }

  async beforeUpdate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
    await this.encrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }

  async afterCreate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }

  async afterUpdate(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }

  async afterUpsert(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }

  async onLoad(args: EventArgs<any>) {
    await this.decrypt(args.entity as Record<string, unknown>, args.meta, args.em)
  }
}
