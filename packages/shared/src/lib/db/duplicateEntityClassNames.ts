/**
 * Detection and reporting for entity class names contributed by more than one module.
 *
 * MikroORM keys metadata by the JS class name. Discovery does keep a separate metadata
 * entry per constructor, so class-based lookups such as `em.find(Invoice)` stay correct,
 * but every name-based resolution — a string relation target, `getRepository('<Name>')`,
 * relation discovery, serialization — goes through the name-keyed map, where only one of
 * the same-named classes survives. Which one wins is decided by registration order, and
 * the loser is reachable by class only. Nothing fails; the wrong table is simply used.
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

/**
 * Stable, constant sentences shared by both reporting surfaces: the structured runtime
 * log line puts them in fields, the generator renders them inline.
 */
export const DUPLICATE_ENTITY_CLASS_NAMES_REASON =
  "MikroORM keeps one metadata entry per constructor, so class-based lookups such as em.find(<Name>) stay correct, but every name-based resolution — string relation targets, getRepository('<Name>'), relation discovery and serialization — goes through the name-keyed map, where only one of the same-named classes survives. Which one wins depends on registration order, so the other silently reads and writes the surviving class's table."

export const DUPLICATE_ENTITY_CLASS_NAMES_REMEDIATION =
  'Rename all but one of the colliding classes so every entity class name is unique across enabled modules, then update their exports, relation targets and imports. Table names may stay as they are.'

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

/**
 * Prefer the runtime class, then the declaring module and file. When an entry carries
 * none of those, fall back to the entry itself so it stays distinct: an unidentifiable
 * entry should fail open and surface a possible collision rather than collapse into a
 * shared bucket key and hide one.
 */
function identify(entry: EntityClassNameEntry): unknown {
  if (entry.target) return entry.target
  if (entry.moduleId || entry.sourcePath) return `${entry.moduleId ?? ''}|${entry.sourcePath ?? ''}`
  return entry
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
    DUPLICATE_ENTITY_CLASS_NAMES_REASON,
    DUPLICATE_ENTITY_CLASS_NAMES_REMEDIATION,
  ]
  for (const group of groups) {
    lines.push(`  ${group.className}`)
    for (const source of group.sources) {
      lines.push(formatSource(source))
    }
  }
  return lines.join('\n')
}

export type DuplicateEntityClassNameFields = {
  classNames: string[]
  duplicates: Array<{ className: string; sources: DuplicateEntityClassNameSource[] }>
  reason: string
  remediation: string
}

/**
 * The same collisions as queryable fields, for callers logging through the structured
 * facade, where the message must stay constant and the dynamic values live beside it.
 */
export function toDuplicateEntityClassNameFields(
  groups: readonly DuplicateEntityClassNameGroup[],
): DuplicateEntityClassNameFields {
  return {
    classNames: groups.map((group) => group.className),
    duplicates: groups.map((group) => ({ className: group.className, sources: group.sources })),
    reason: DUPLICATE_ENTITY_CLASS_NAMES_REASON,
    remediation: DUPLICATE_ENTITY_CLASS_NAMES_REMEDIATION,
  }
}
