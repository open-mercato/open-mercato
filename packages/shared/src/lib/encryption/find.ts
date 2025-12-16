import type {
  AnyEntityName,
  EntityManager,
  FilterQuery,
  FindOneOptions,
  FindOptions,
} from '@mikro-orm/postgresql'
import { decryptEntitiesWithFallbackScope } from './subscriber'
import type { TenantDataEncryptionService } from './tenantDataEncryptionService'

export type DecryptionScope = {
  tenantId?: string | null
  organizationId?: string | null
  encryptionService?: TenantDataEncryptionService | null
}

export async function findWithDecryption<Entity extends object>(
  em: EntityManager,
  entityName: AnyEntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: FindOptions<Entity>,
  scope?: DecryptionScope,
): Promise<Entity[]> {
  const records = await em.find(entityName as any, where as any, options as any)
  if (!records.length) return records
  await decryptEntitiesWithFallbackScope(records, {
    em,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    encryptionService: scope?.encryptionService ?? null,
  })
  return records
}

export async function findOneWithDecryption<Entity extends object>(
  em: EntityManager,
  entityName: AnyEntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: FindOneOptions<Entity>,
  scope?: DecryptionScope,
): Promise<Entity | null> {
  const record = await em.findOne(entityName as any, where as any, options as any)
  if (!record) return record
  await decryptEntitiesWithFallbackScope(record, {
    em,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    encryptionService: scope?.encryptionService ?? null,
  })
  return record
}
