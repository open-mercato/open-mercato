import type {
  EntityManager,
  EntityName,
  FilterQuery,
  FindOneOptions,
  FindOptions,
} from '@mikro-orm/postgresql'
import {
  findAndCountWithDecryption,
  findOneWithDecryption,
  findWithDecryption,
  type DecryptionScope,
} from '@open-mercato/shared/lib/encryption/find'

type AnyFindOptions<Entity extends object, Hint extends string = any> = FindOptions<Entity, Hint, any, any>
type AnyFindOneOptions<Entity extends object, Hint extends string = any> = FindOneOptions<Entity, Hint, any, any>

function extractScope(where: unknown, scope?: DecryptionScope): DecryptionScope {
  if (scope?.tenantId || scope?.organizationId || scope?.encryptionService) return scope
  if (!where || typeof where !== 'object') return scope ?? {}

  const record = where as { tenantId?: unknown; organizationId?: unknown }
  return {
    tenantId: typeof record.tenantId === 'string' ? record.tenantId : null,
    organizationId: typeof record.organizationId === 'string' ? record.organizationId : null,
  }
}

export function incidentFind<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<Entity[]> {
  return findWithDecryption(em, entityName, where, options, extractScope(where, scope))
}

export function incidentFindOne<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOneOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<Entity | null> {
  return findOneWithDecryption(em, entityName, where, options, extractScope(where, scope))
}

export function incidentFindAndCount<Entity extends object, Hint extends string = any>(
  em: EntityManager,
  entityName: EntityName<Entity>,
  where: FilterQuery<Entity>,
  options?: AnyFindOptions<Entity, Hint>,
  scope?: DecryptionScope,
): Promise<[Entity[], number]> {
  return findAndCountWithDecryption(em, entityName, where, options, extractScope(where, scope))
}
