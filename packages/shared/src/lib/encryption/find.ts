import type {
  EntityManager,
  EntityName,
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

type AnyFindOptions<Entity extends object, Hint extends string = any> = FindOptions<Entity, Hint, any, any>
type AnyFindOneOptions<Entity extends object, Hint extends string = any> = FindOneOptions<Entity, Hint, any, any>

export async function findWithDecryption<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<Entity[]> {
  const records = await em.find<Entity, Hint, any, any>(entityName as any, where as any, options as any) as any as Entity[]
  if (!records.length) return records
  await decryptEntitiesWithFallbackScope(records, {
    em,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    encryptionService: scope?.encryptionService ?? null,
  })
  return records
}

export async function findOneWithDecryption<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOneOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<Entity | null> {
  const record = await em.findOne<Entity, Hint, any, any>(entityName as any, where as any, options as any) as any as Entity | null
  if (!record) return record
  await decryptEntitiesWithFallbackScope(record, {
    em,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    encryptionService: scope?.encryptionService ?? null,
  })
  return record
}

export async function findAndCountWithDecryption<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<[Entity[], number]> {
  const [records, count] = await em.findAndCount<Entity, Hint, any, any>(
    entityName as any,
    where as any,
    options as any,
  ) as any as [Entity[], number]
  if (!records.length) return [records, count]
  await decryptEntitiesWithFallbackScope(records, {
    em,
    tenantId: scope?.tenantId ?? null,
    organizationId: scope?.organizationId ?? null,
    encryptionService: scope?.encryptionService ?? null,
  })
  return [records, count]
}
