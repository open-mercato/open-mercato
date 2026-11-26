import type { EntityCtor } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'

export function isRegisteredModuleEntity<Entity>(
  em: EntityManager,
  entity: EntityCtor<Entity>,
  qualifiedName: string,
): boolean {
  const registeredClass: (EntityCtor<Entity> & { entityName?: string }) | undefined =
    em.getMetadata().find(entity)?.class
  return registeredClass === entity || registeredClass?.entityName === qualifiedName
}
