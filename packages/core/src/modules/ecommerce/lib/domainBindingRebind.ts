import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { EcommerceStoreDomainBinding } from '../data/entities'
import { resourceKindFor, STORE_DOMAIN_BINDING_EVENT_ENTITY } from './crudEvents'
import { domainBindingEvents, domainBindingIndexer } from './storeBindingCascade'
import {
  asPayloadRecord,
  readEventScope,
  readPayloadString,
  tryResolveService,
  type EcommerceSubscriberContext,
} from './subscriberSupport'

/**
 * Follows `customer_accounts` domain supersession (SPEC-029 §5.2, D5): when a replacement mapping
 * becomes active, `customer_accounts.domain_mapping.replaced` carries the new mapping as `id` and the
 * superseded one as `replacedDomainId`. Every live binding on the superseded id is re-pointed to the
 * new id within the same tenant and organization. Re-running is a no-op because no binding is left
 * on the superseded id; a binding whose `path_prefix` is already taken on the new mapping stays on
 * the superseded id (dangling, R3) and is logged.
 */

export type DomainMappingReplacement = {
  domainMappingId: string
  replacedDomainMappingId: string
  tenantId: string
  organizationId: string
}

export type DomainBindingRebindResult = {
  rebound: EcommerceStoreDomainBinding[]
  skipped: EcommerceStoreDomainBinding[]
}

const logger = createLogger('ecommerce').child({ component: 'domain-binding-rebind' })

export function readDomainMappingReplacement(
  payload: unknown,
  ctx: EcommerceSubscriberContext,
): DomainMappingReplacement | null {
  const record = asPayloadRecord(payload)
  const domainMappingId = readPayloadString(record, 'id')
  const replacedDomainMappingId = readPayloadString(record, 'replacedDomainId')
  const { tenantId, organizationId } = readEventScope(record, ctx)
  if (!domainMappingId || !replacedDomainMappingId || !tenantId || !organizationId) return null
  if (domainMappingId === replacedDomainMappingId) return null
  return { domainMappingId, replacedDomainMappingId, tenantId, organizationId }
}

function prefixKey(binding: EcommerceStoreDomainBinding): string {
  return binding.pathPrefix ?? ''
}

function findLiveBindings(
  em: EntityManager,
  domainMappingId: string,
  replacement: DomainMappingReplacement,
): Promise<EcommerceStoreDomainBinding[]> {
  const scope = { tenantId: replacement.tenantId, organizationId: replacement.organizationId }
  return findWithDecryption(
    em,
    EcommerceStoreDomainBinding,
    { domainMappingId, ...scope, deletedAt: null } as FilterQuery<EcommerceStoreDomainBinding>,
    undefined,
    scope,
  )
}

async function announceRebound(
  ctx: EcommerceSubscriberContext,
  bindings: EcommerceStoreDomainBinding[],
): Promise<void> {
  const dataEngine = tryResolveService<DataEngine>(ctx, 'dataEngine')
  if (dataEngine) {
    for (const binding of bindings) {
      dataEngine.markOrmEntityChange({
        action: 'updated',
        entity: binding,
        identifiers: { id: binding.id, tenantId: binding.tenantId, organizationId: binding.organizationId },
        events: domainBindingEvents,
        indexer: domainBindingIndexer,
      })
    }
    await dataEngine.flushOrmEntityChanges()
  }
  const container = { resolve: ctx.resolve } as unknown as AwilixContainer
  const resourceKind = resourceKindFor(STORE_DOMAIN_BINDING_EVENT_ENTITY)
  for (const binding of bindings) {
    await invalidateCrudCache(
      container,
      resourceKind,
      { id: binding.id, tenantId: binding.tenantId, organizationId: binding.organizationId },
      binding.tenantId,
      'updated',
    )
  }
}

export async function rebindReplacedDomainMapping(
  ctx: EcommerceSubscriberContext,
  replacement: DomainMappingReplacement,
): Promise<DomainBindingRebindResult> {
  const rootEm = tryResolveService<EntityManager>(ctx, 'em')
  if (!rootEm) throw new Error('[internal] ecommerce domain re-binding requires the DI entity manager')
  const em = rootEm.fork()
  const superseded = await findLiveBindings(em, replacement.replacedDomainMappingId, replacement)
  if (superseded.length === 0) return { rebound: [], skipped: [] }
  const existing = await findLiveBindings(em, replacement.domainMappingId, replacement)
  const takenPrefixes = new Set(existing.map(prefixKey))
  const rebound: EcommerceStoreDomainBinding[] = []
  const skipped: EcommerceStoreDomainBinding[] = []
  for (const binding of superseded) {
    const key = prefixKey(binding)
    if (takenPrefixes.has(key)) {
      skipped.push(binding)
      continue
    }
    takenPrefixes.add(key)
    binding.domainMappingId = replacement.domainMappingId
    rebound.push(binding)
  }
  if (rebound.length > 0) await em.flush()
  for (const binding of skipped) {
    logger.warn('Domain binding not re-pointed: path prefix already bound on the replacement mapping', {
      bindingId: binding.id,
      storeId: binding.storeId,
      pathPrefix: binding.pathPrefix ?? null,
      domainMappingId: replacement.domainMappingId,
      replacedDomainMappingId: replacement.replacedDomainMappingId,
    })
  }
  if (rebound.length > 0) await announceRebound(ctx, rebound)
  return { rebound, skipped }
}
