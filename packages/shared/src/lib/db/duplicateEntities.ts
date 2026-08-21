import { EntitySchema, MetadataStorage } from '@mikro-orm/core'
import {
  findDuplicateEntityClassNames,
  type DuplicateEntityClassNameGroup,
  type EntityClassNameEntry,
} from './duplicateEntityClassNames'

/**
 * Adapts a registered ORM entity array to the dependency-free collision detector in
 * `./duplicateEntityClassNames`, which explains the underlying MikroORM behaviour.
 */

type DecoratedEntityClass = {
  readonly name?: unknown
  readonly entityName?: unknown
  readonly [MetadataStorage.PATH_SYMBOL]?: unknown
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `enhanceEntities()` in the generated entity registry stamps `<moduleId>.<ExportName>`
 * onto every entity export. MikroORM ignores that stamp, but it is the only place the
 * contributing module id survives to runtime. Module ids may contain dots; the export
 * name never does, so split on the last one.
 */
function readModuleIdFromStamp(stamp: unknown): string | undefined {
  const value = readString(stamp)
  if (!value) return undefined
  const separator = value.lastIndexOf('.')
  return separator > 0 ? value.slice(0, separator) : undefined
}

/**
 * The registered array holds every function export of each module's entity file, so
 * plain helper functions travel alongside real entities. Only classes touched by a
 * MikroORM decorator carry `MetadataStorage.PATH_SYMBOL` as an own property; everything
 * else is skipped so helpers that happen to share a name are never reported.
 */
function toEntityClassNameEntry(value: unknown): EntityClassNameEntry | null {
  // `enhanceEntities()` in the generated registry keeps only `typeof value === 'function'`
  // exports, so an EntitySchema a module exports never arrives through it. This branch is
  // live only for direct callers such as the testing bootstrap — and since the module id
  // stamp is applied to those same function exports, an EntitySchema carries no module id
  // and reports by path alone.
  if (EntitySchema.is(value)) {
    const className = readString(value.meta?.className)
    if (!className) return null
    return { className, sourcePath: readString(value.meta?.path), target: value }
  }
  if (typeof value !== 'function') return null
  if (!Object.prototype.hasOwnProperty.call(value, MetadataStorage.PATH_SYMBOL)) return null
  const entity = value as DecoratedEntityClass
  const className = readString(entity.name)
  if (!className) return null
  return {
    className,
    moduleId: readModuleIdFromStamp(entity.entityName),
    sourcePath: readString(entity[MetadataStorage.PATH_SYMBOL]),
    target: value,
  }
}

export function collectEntityClassNameEntries(entities: readonly unknown[]): EntityClassNameEntry[] {
  const entries: EntityClassNameEntry[] = []
  for (const value of entities) {
    let entry: EntityClassNameEntry | null = null
    try {
      entry = toEntityClassNameEntry(value)
    } catch {
      // Reading a name off an exotic export (a throwing getter, a proxy) must not turn
      // a diagnostic into a boot failure. Skip the value and keep checking the rest.
      continue
    }
    if (entry) entries.push(entry)
  }
  return entries
}

export function findDuplicateRegisteredEntityClassNames(
  entities: readonly unknown[],
): DuplicateEntityClassNameGroup[] {
  return findDuplicateEntityClassNames(collectEntityClassNameEntries(entities))
}
