import { z, type ZodTypeAny } from 'zod'

/**
 * The output-integrity path dialect (spec `2026-10-21-output-integrity-guardrails`):
 * dot-separated property names, each optionally followed by `[*]` (every array
 * item) or `[n]` (one array item). No filters, no recursion, no quoting — a path
 * is a deterministic address, validated against the agent's result schema at
 * registration. Prototype-reaching names are rejected outright.
 */
export type IntegrityPathSegment =
  | { type: 'key'; name: string }
  | { type: 'wildcard' }
  | { type: 'index'; index: number }

export type IntegrityPathMatch = { value: unknown; concretePath: string }

export type IntegrityPathSchemaCheck =
  | { ok: true; leaves: ZodTypeAny[] }
  | { ok: false; segment: string; segmentIndex: number }

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const SEGMENT_PATTERN = /^([A-Za-z0-9_$-]*)((?:\[(?:\*|\d+)\])*)$/
const BRACKET_PATTERN = /\[(\*|\d+)\]/g

export class IntegrityPathError extends Error {}

export function parseIntegrityPath(path: string): IntegrityPathSegment[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new IntegrityPathError('[internal] integrity path must be a non-empty string')
  }
  const segments: IntegrityPathSegment[] = []
  const parts = path.split('.')
  parts.forEach((part, partIndex) => {
    const matched = SEGMENT_PATTERN.exec(part)
    if (!matched) {
      throw new IntegrityPathError(`[internal] invalid integrity path "${path}" at "${part}"`)
    }
    const [, name, brackets] = matched
    if (!name && (partIndex > 0 || !brackets)) {
      throw new IntegrityPathError(`[internal] invalid integrity path "${path}" at "${part}"`)
    }
    if (name) {
      if (UNSAFE_SEGMENTS.has(name)) {
        throw new IntegrityPathError(`[internal] unsafe integrity path segment "${name}" in "${path}"`)
      }
      segments.push({ type: 'key', name })
    }
    for (const bracket of brackets.matchAll(BRACKET_PATTERN)) {
      const token = bracket[1]
      segments.push(token === '*' ? { type: 'wildcard' } : { type: 'index', index: Number(token) })
    }
  })
  return segments
}

export function isValidIntegrityPath(path: string): boolean {
  try {
    parseIntegrityPath(path)
    return true
  } catch {
    return false
  }
}

export function formatIntegrityPath(segments: readonly IntegrityPathSegment[]): string {
  return segments.reduce((formatted, segment) => {
    if (segment.type === 'key') return formatted ? `${formatted}.${segment.name}` : segment.name
    if (segment.type === 'wildcard') return `${formatted}[*]`
    return `${formatted}[${segment.index}]`
  }, '')
}

function toSegments(path: string | readonly IntegrityPathSegment[]): readonly IntegrityPathSegment[] {
  return typeof path === 'string' ? parseIntegrityPath(path) : path
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/**
 * Every value the path addresses, with the concrete (`[n]`-indexed) path of each.
 * Missing properties, out-of-range indexes and type mismatches simply yield no
 * match — absence is the caller's verdict to make, never an exception.
 */
export function readAll(value: unknown, path: string | readonly IntegrityPathSegment[]): IntegrityPathMatch[] {
  const segments = toSegments(path)
  let frontier: Array<{ value: unknown; trail: IntegrityPathSegment[] }> = [{ value, trail: [] }]
  for (const segment of segments) {
    const next: typeof frontier = []
    for (const entry of frontier) {
      if (segment.type === 'key') {
        if (isPlainRecord(entry.value) && hasOwn(entry.value, segment.name)) {
          next.push({ value: entry.value[segment.name], trail: [...entry.trail, segment] })
        }
      } else if (Array.isArray(entry.value)) {
        if (segment.type === 'wildcard') {
          entry.value.forEach((item, itemIndex) => {
            next.push({ value: item, trail: [...entry.trail, { type: 'index', index: itemIndex }] })
          })
        } else if (segment.index < entry.value.length) {
          next.push({ value: entry.value[segment.index], trail: [...entry.trail, segment] })
        }
      }
    }
    frontier = next
  }
  return frontier.map((entry) => ({ value: entry.value, concretePath: formatIntegrityPath(entry.trail) }))
}

function requireConcrete(path: string | readonly IntegrityPathSegment[]): readonly IntegrityPathSegment[] {
  const segments = toSegments(path)
  if (segments.length === 0) throw new IntegrityPathError('[internal] integrity path must not be empty')
  if (segments.some((segment) => segment.type === 'wildcard')) {
    throw new IntegrityPathError(`[internal] concrete integrity path expected, got "${formatIntegrityPath(segments)}"`)
  }
  return segments
}

function copyContainer(value: unknown, segment: IntegrityPathSegment, fullPath: string): unknown[] | Record<string, unknown> {
  if (segment.type === 'key') {
    if (!isPlainRecord(value)) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" does not address an object`)
    return { ...value }
  }
  if (!Array.isArray(value)) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" does not address an array`)
  return [...value]
}

function updateAt(
  value: unknown,
  segments: readonly IntegrityPathSegment[],
  fullPath: string,
  apply: (container: unknown[] | Record<string, unknown>, last: IntegrityPathSegment) => void,
): unknown {
  const [head, ...rest] = segments
  const copy = copyContainer(value, head, fullPath)
  if (rest.length === 0) {
    apply(copy, head)
    return copy
  }
  if (head.type === 'key') {
    const record = copy as Record<string, unknown>
    if (!hasOwn(record, head.name)) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" is missing "${head.name}"`)
    record[head.name] = updateAt(record[head.name], rest, fullPath, apply)
    return record
  }
  const list = copy as unknown[]
  const index = head.type === 'index' ? head.index : -1
  if (index < 0 || index >= list.length) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" index out of range`)
  list[index] = updateAt(list[index], rest, fullPath, apply)
  return list
}

/**
 * Returns a copy of `value` with `newValue` written at the concrete path. The input
 * is never mutated: every container along the path is copied, untouched branches
 * are shared. A missing final object key is created; any other missing step throws.
 */
export function writeAt(value: unknown, concretePath: string | readonly IntegrityPathSegment[], newValue: unknown): unknown {
  const segments = requireConcrete(concretePath)
  const fullPath = formatIntegrityPath(segments)
  return updateAt(value, segments, fullPath, (container, last) => {
    if (last.type === 'key') {
      ;(container as Record<string, unknown>)[last.name] = newValue
      return
    }
    const list = container as unknown[]
    const index = last.type === 'index' ? last.index : -1
    if (index < 0 || index >= list.length) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" index out of range`)
    list[index] = newValue
  })
}

/**
 * Returns a copy of `value` with the array item at the concrete path removed (the
 * `drop` semantics). The path must end in an index; the input is never mutated.
 */
export function removeAt(value: unknown, concretePath: string | readonly IntegrityPathSegment[]): unknown {
  const segments = requireConcrete(concretePath)
  const fullPath = formatIntegrityPath(segments)
  if (segments[segments.length - 1].type !== 'index') {
    throw new IntegrityPathError(`[internal] integrity path "${fullPath}" must end in an array index to be removed`)
  }
  return updateAt(value, segments, fullPath, (container, last) => {
    const list = container as unknown[]
    const index = last.type === 'index' ? last.index : -1
    if (index < 0 || index >= list.length) throw new IntegrityPathError(`[internal] integrity path "${fullPath}" index out of range`)
    list.splice(index, 1)
  })
}

function compareConcretePaths(left: readonly IntegrityPathSegment[], right: readonly IntegrityPathSegment[]): number {
  const shared = Math.min(left.length, right.length)
  for (let position = 0; position < shared; position += 1) {
    const leftSegment = left[position]
    const rightSegment = right[position]
    if (leftSegment.type === 'index' && rightSegment.type === 'index') {
      if (leftSegment.index !== rightSegment.index) return leftSegment.index - rightSegment.index
    } else if (leftSegment.type === 'key' && rightSegment.type === 'key') {
      if (leftSegment.name !== rightSegment.name) return leftSegment.name < rightSegment.name ? -1 : 1
    }
  }
  return left.length - right.length
}

/**
 * Removes several array items at once. Paths are applied deepest-and-last first so
 * that earlier removals never shift the indexes of later ones; duplicates collapse.
 */
export function removeAllAt(value: unknown, concretePaths: readonly string[]): unknown {
  const unique = Array.from(new Set(concretePaths)).map((path) => requireConcrete(path))
  unique.sort((left, right) => compareConcretePaths(right, left))
  return unique.reduce<unknown>((current, segments) => removeAt(current, segments), value)
}

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny[] {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodLazy
  ) {
    return unwrapSchema(schema.unwrap() as ZodTypeAny)
  }
  if (schema instanceof z.ZodPipe) {
    const side = schema.out instanceof z.ZodTransform ? schema.in : schema.out
    return unwrapSchema(side as ZodTypeAny)
  }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    return (schema.options as readonly ZodTypeAny[]).flatMap((option) => unwrapSchema(option))
  }
  if (schema instanceof z.ZodIntersection) {
    const definition = schema._zod.def
    return [...unwrapSchema(definition.left as ZodTypeAny), ...unwrapSchema(definition.right as ZodTypeAny)]
  }
  return [schema]
}

function isOpenSchema(schema: ZodTypeAny): boolean {
  return schema instanceof z.ZodUnknown || schema instanceof z.ZodAny
}

function stepSchema(schema: ZodTypeAny, segment: IntegrityPathSegment): ZodTypeAny[] {
  if (isOpenSchema(schema)) return [schema]
  if (segment.type === 'key') {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, ZodTypeAny>
      if (hasOwn(shape, segment.name)) return [shape[segment.name]]
      const catchall = schema._zod.def.catchall as ZodTypeAny | undefined
      return catchall && !(catchall instanceof z.ZodNever) ? [catchall] : []
    }
    if (schema instanceof z.ZodRecord) return [schema.valueType as ZodTypeAny]
    return []
  }
  if (schema instanceof z.ZodArray) return [schema.element as ZodTypeAny]
  return []
}

/**
 * Walks `schema` along `path` and reports whether the path can exist in a value the
 * schema accepts. Wrappers (optional, nullable, default, readonly, lazy, pipes,
 * catch) are unwrapped; a union or intersection passes when ANY branch does;
 * `unknown`/`any` accept every continuation. On success the (unwrapped) leaf
 * schemas are returned so a caller can validate an item-relative path against them.
 */
export function validatePathAgainstSchema(
  schema: ZodTypeAny,
  path: string | readonly IntegrityPathSegment[],
): IntegrityPathSchemaCheck {
  const segments = toSegments(path)
  let current = unwrapSchema(schema)
  for (let position = 0; position < segments.length; position += 1) {
    const segment = segments[position]
    const next = current.flatMap((candidate) => stepSchema(candidate, segment)).flatMap((candidate) => unwrapSchema(candidate))
    if (next.length === 0) {
      return { ok: false, segment: formatIntegrityPath([segment]) || '[*]', segmentIndex: position }
    }
    current = next
  }
  return { ok: true, leaves: current }
}
