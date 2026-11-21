import { MetadataStorage } from '@mikro-orm/core'

type EntityClass = abstract new (...args: never[]) => object

/**
 * The table name a decorated entity class declares, read from MikroORM's
 * decorator metadata (what `args.meta.tableName` carries at flush time).
 * Undefined for a class that is not a decorated entity.
 */
export function decoratedTableName(entityClass: EntityClass | undefined): string | undefined {
  if (!entityClass || !Object.hasOwn(entityClass, MetadataStorage.PATH_SYMBOL)) return undefined
  const path = (entityClass as unknown as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
  const meta = MetadataStorage.getMetadata(entityClass.name, path, entityClass as never)
  return typeof meta.tableName === 'string' ? meta.tableName : undefined
}
