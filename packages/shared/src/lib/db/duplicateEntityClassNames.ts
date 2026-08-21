/**
 * Detection and reporting for entity class names contributed by more than one module.
 *
 * MikroORM keys entity metadata by the JS class name. `MetadataStorage` holds both a
 * constructor-keyed map and a name-keyed one, and `find()` falls through to the
 * name-keyed one, so when discovery calls `get(cls, true)` for a second class sharing a
 * name it resolves the first class's metadata instead of creating its own. The two
 * classes silently collapse onto one set of metadata — table name included — rather
 * than failing discovery.
 *
 * Nothing upstream catches it: `discovery.checkDuplicateEntities` is declared as a
 * default in @mikro-orm/core 7.1.9 but is read nowhere, and the one live check compares
 * table names rather than class names, which never collide here because every entity
 * declares an explicit `tableName`.
 *
 * This module is deliberately dependency-free so both the build-time generator and the
 * runtime bootstrap can share it without pulling the ORM into the generator. Detection
 * is kept separate from reporting so each caller decides whether a collision warns or
 * throws.
 */

export type EntityClassNameEntry = {
  className: string
  moduleId?: string
  sourcePath?: string
  /**
   * Runtime identity of the class. Two entries sharing a target are the same class
   * reached twice — re-exported through a second import path, or re-registered by an
   * HMR reload — and never count as a collision. Absent at build time, where the
   * declaring module and file identify the class instead.
   */
  target?: object
}

export type DuplicateEntityClassNameSource = {
  moduleId?: string
  sourcePath?: string
}

export type DuplicateEntityClassNameGroup = {
  className: string
  sources: DuplicateEntityClassNameSource[]
}

function identify(entry: EntityClassNameEntry): unknown {
  return entry.target ?? `${entry.moduleId ?? ''}|${entry.sourcePath ?? ''}`
}

/**
 * Group entries by class name, keeping only names contributed by two or more distinct
 * classes. Order follows first appearance, which is the module registration order.
 */
export function findDuplicateEntityClassNames(
  entries: readonly EntityClassNameEntry[],
): DuplicateEntityClassNameGroup[] {
  const buckets = new Map<string, Map<unknown, DuplicateEntityClassNameSource>>()
  for (const entry of entries) {
    if (!entry.className) continue
    let bucket = buckets.get(entry.className)
    if (!bucket) {
      bucket = new Map<unknown, DuplicateEntityClassNameSource>()
      buckets.set(entry.className, bucket)
    }
    const identity = identify(entry)
    if (!bucket.has(identity)) {
      bucket.set(identity, { moduleId: entry.moduleId, sourcePath: entry.sourcePath })
    }
  }
  const groups: DuplicateEntityClassNameGroup[] = []
  for (const [className, bucket] of buckets) {
    if (bucket.size < 2) continue
    groups.push({ className, sources: Array.from(bucket.values()) })
  }
  return groups
}

/**
 * At runtime the source path comes from MikroORM's decorator, which derives it by
 * parsing a stack trace and falls back to the bare class name when that parse fails, so
 * only render a value that still looks like a path.
 */
function formatSource(source: DuplicateEntityClassNameSource): string {
  const path = source.sourcePath && /[\\/]/.test(source.sourcePath) ? source.sourcePath : undefined
  if (source.moduleId && path) return `    - ${source.moduleId} (${path})`
  if (source.moduleId) return `    - ${source.moduleId}`
  if (path) return `    - ${path}`
  return '    - unknown module'
}

/**
 * Render every collision in one message, so a fix does not have to be discovered one
 * rerun at a time. Callers prepend their own surface prefix.
 */
export function formatDuplicateEntityClassNamesWarning(
  groups: readonly DuplicateEntityClassNameGroup[],
): string {
  const names = groups.map((group) => `"${group.className}"`).join(', ')
  const lines = [
    `Duplicate entity class name(s) defined by more than one enabled module: ${names}.`,
    "MikroORM resolves entities by JS class name for string relation targets, getRepository('<Name>'), relation discovery and serialization, so one silently shadows the other — the shadowed class ends up aliased to the surviving class's metadata, table name included. Class-based lookups such as em.find(<Name>) keep working, which is why this never fails loudly.",
    'Rename all but one of the classes below so every entity class name is unique across enabled modules, then update their exports, relation targets and imports. Table names may stay as they are.',
  ]
  for (const group of groups) {
    lines.push(`  ${group.className}`)
    for (const source of group.sources) {
      lines.push(formatSource(source))
    }
  }
  return lines.join('\n')
}
