import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
export { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { EcommerceStore, EcommerceStoreDomain, EcommerceStoreChannelBinding } from '../data/entities'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function assertRecordFound<T>(record: T | null | undefined, message: string): T {
  if (!record) throw new CrudHttpError(404, { error: message })
  return record
}

export async function requireStore(em: EntityManager, id: string): Promise<EcommerceStore> {
  const store = await em.findOne(EcommerceStore, { id, deletedAt: null })
  return assertRecordFound(store, 'Store not found')
}

export async function requireStoreDomain(em: EntityManager, id: string): Promise<EcommerceStoreDomain> {
  const domain = await em.findOne(EcommerceStoreDomain, { id, deletedAt: null })
  return assertRecordFound(domain, 'Store domain not found')
}

export async function requireStoreChannelBinding(em: EntityManager, id: string): Promise<EcommerceStoreChannelBinding> {
  const binding = await em.findOne(EcommerceStoreChannelBinding, { id, deletedAt: null })
  return assertRecordFound(binding, 'Store channel binding not found')
}
