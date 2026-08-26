import { z } from 'zod'
import { CrudHttpError } from './errors'

/**
 * Guards against write payloads that are accepted and then silently discarded.
 *
 * A `PUT` that answers `200 {"ok":true}` while dropping half the body is worse
 * than one that fails: the caller has no way to tell "written" from "ignored"
 * short of reading the record back. Two mechanisms produced exactly that in the
 * customers module:
 *
 *  - Zod strips unknown keys by default, so `closure_outcome` vanished while the
 *    sibling `status` in the same body was applied. The read endpoints emit
 *    snake_case, so a caller round-tripping a record it had just read wrote
 *    nothing at all and was told it had succeeded.
 *  - A field can pass validation and still be dropped further down, by a mapper
 *    that only forwards the keys it knows about.
 *
 * The helpers here address the first mechanism by ALIASING snake_case onto the
 * camelCase key the schema actually declares, and make the second visible by
 * reporting whatever survives as unwritable.
 */

/** A key the caller sent that the schema does not declare. */
export type UnwritableKey = {
  key: string
  /** `unknown` — no such field. `immutable` — a real field that cannot be changed after creation. */
  reason: 'unknown' | 'immutable'
}

export type WritePayloadInspection = {
  /** The payload with snake_case keys renamed onto their camelCase equivalents. */
  payload: Record<string, unknown>
  /** snake_case keys that were renamed, as `{ from, to }`. Reported so callers can be migrated. */
  aliased: Array<{ from: string; to: string }>
  /** Keys that will NOT be applied. Never silently dropped — either reported or rejected. */
  unwritable: UnwritableKey[]
  /** Both spellings of one field arrived carrying different values. Ambiguous, so never guessed at. */
  conflicts: Array<{ camel: string; snake: string }>
}

/**
 * Top-level keys a schema will actually accept.
 *
 * Unwraps the wrappers the customers write schemas are built from — `.partial()`
 * and `.merge()` both yield a plain object, but `.superRefine()` / `.transform()`
 * wrap it in a `ZodEffects`, and `interactionUpdateSchema` uses both. Returns
 * `null` for a shape we cannot introspect (a union, say), which every caller
 * below treats as "do not guess", leaving today's behaviour untouched.
 */
export function collectWritableKeys(schema: z.ZodTypeAny): Set<string> | null {
  let current: any = schema
  // `.optional()`, `.nullable()`, `.default()` and `.superRefine()` can nest.
  for (let depth = 0; depth < 10; depth += 1) {
    if (!current || typeof current !== 'object') return null
    const def = current._def
    if (!def) return null
    if (typeof current.shape === 'object' && current.shape !== null) {
      return new Set(Object.keys(current.shape))
    }
    // zod v3 exposes `.shape` as a getter on ZodObject; v4 keeps it too, but the
    // wrappers below hide it, so unwrap one layer at a time.
    const inner = def.schema ?? def.innerType ?? def.in ?? null
    if (!inner) return null
    current = inner
  }
  return null
}

/**
 * Custom-field keys travel beside the declared schema fields and are routed by
 * `splitCustomFieldPayload` further down, so no write schema declares them. The
 * guard has to skip them, or a legitimate `cf_priority` gets reported as a field
 * the endpoint ignored.
 */
const CUSTOM_FIELD_CONTAINER_KEYS = new Set(['customFields', 'customValues'])

export function isCustomFieldKey(key: string): boolean {
  return CUSTOM_FIELD_CONTAINER_KEYS.has(key) || key.startsWith('cf_') || key.startsWith('cf:')
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase())
}

/**
 * Rename snake_case keys onto the camelCase names the schema declares.
 *
 * Deliberately conservative — a key is only renamed when the schema declares the
 * camelCase spelling AND the caller did not already send it. A payload that
 * carries both spellings with DIFFERENT values is a genuine ambiguity, so it is
 * reported as a conflict rather than resolved by precedence; picking a winner
 * would reintroduce the very "one of your fields was ignored" bug this fixes.
 *
 * `immutableFields` names real fields that cannot change after creation (the
 * activities bridge's `entityId`), so the caller gets "cannot be changed" rather
 * than a misleading "unknown field".
 */
export function inspectWritePayload(
  payload: unknown,
  writableKeys: Set<string> | null,
  options: { immutableFields?: readonly string[] } = {}
): WritePayloadInspection {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {}
  const immutable = new Set(options.immutableFields ?? [])
  const aliased: Array<{ from: string; to: string }> = []
  const conflicts: Array<{ camel: string; snake: string }> = []
  const unwritable: UnwritableKey[] = []

  if (!writableKeys) {
    // Unintrospectable schema: report immutable hits, otherwise leave untouched.
    for (const key of Object.keys(source)) {
      if (immutable.has(key)) unwritable.push({ key, reason: 'immutable' })
    }
    return { payload: source, aliased, unwritable, conflicts }
  }

  for (const key of Object.keys(source)) {
    if (!key.includes('_')) continue
    const camel = snakeToCamel(key)
    if (camel === key) continue
    if (!writableKeys.has(camel) && !immutable.has(camel)) continue
    if (Object.prototype.hasOwnProperty.call(source, camel)) {
      if (source[camel] !== source[key]) conflicts.push({ camel, snake: key })
      delete source[key]
      continue
    }
    source[camel] = source[key]
    delete source[key]
    aliased.push({ from: key, to: camel })
  }

  for (const key of Object.keys(source)) {
    if (immutable.has(key)) {
      unwritable.push({ key, reason: 'immutable' })
      continue
    }
    if (!writableKeys.has(key)) unwritable.push({ key, reason: 'unknown' })
  }

  return { payload: source, aliased, unwritable, conflicts }
}

/**
 * Attach the write guard's findings to a command response.
 *
 * Turns `{ ok: true }` into `{ ok: true, ignoredFields: [...] }` whenever the
 * request carried keys the endpoint will not write, so a caller can assert on
 * the response instead of re-reading the record to find out what happened.
 * Absent any such key the response is byte-identical to today's.
 */
export function withIgnoredFieldsReport<T extends Record<string, unknown>>(
  payload: T,
  input: unknown
): T & { ignoredFields?: UnwritableKey[] } {
  const ignored = (input as { ignoredFields?: UnwritableKey[] } | null | undefined)?.ignoredFields
  if (!Array.isArray(ignored) || ignored.length === 0) return payload
  return { ...payload, ignoredFields: ignored }
}

/**
 * How a route handles write keys it will not apply.
 *
 * Zod strips unknown keys, so without this a `PUT` can answer `200` having
 * discarded half the body, and the caller has no way to tell.
 */
export type CrudWriteGuardConfig = {
  /**
   * Rename snake_case keys onto the camelCase names the schema declares.
   *
   * On by default. Strictly additive: it only ever applies keys Zod was already
   * discarding, so no field that takes effect today stops taking effect. It
   * exists because list endpoints across the framework emit snake_case while the
   * write schemas declare camelCase, so a caller that round-trips a record it
   * just read otherwise writes nothing and is told it succeeded.
   */
  aliasSnakeCaseKeys?: boolean
  /** Real fields that cannot change after creation. Rejected with 400, never accepted and dropped. */
  immutableFields?: readonly string[]
  /**
   * Reject unknown keys with 400 instead of reporting them in the response.
   *
   * Off by default: widget injection legitimately puts non-schema keys into form
   * payloads, so a blanket flip would break working forms. Routes that own their
   * payload end-to-end can opt in.
   */
  rejectUnknownFields?: boolean
  /** Optional i18n hook. Without it the English fallbacks below are used verbatim. */
  translate?: (key: string, fallback?: string) => string
}

/**
 * Inspect a write body before parsing it, so nothing is accepted and discarded.
 *
 * Returns the (possibly aliased) body plus whatever it will not write. Throws a
 * 400 for an ambiguous duplicate, for an immutable field, and for an unknown key
 * when the route opted into strictness.
 */
export function guardWriteBody(
  schema: z.ZodTypeAny,
  body: unknown,
  config: CrudWriteGuardConfig | undefined
): { body: unknown; ignoredFields: UnwritableKey[]; aliased: Array<{ from: string; to: string }> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body, ignoredFields: [], aliased: [] }
  }
  const t = config?.translate ?? ((_key: string, fallback?: string) => fallback ?? _key)
  const source = body as Record<string, unknown>
  const declarable: Record<string, unknown> = {}
  const passthrough: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (isCustomFieldKey(key)) passthrough[key] = value
    else declarable[key] = value
  }
  const inspection = inspectWritePayload(declarable, collectWritableKeys(schema), {
    immutableFields: config?.immutableFields,
  })

  if (inspection.conflicts.length > 0) {
    const first = inspection.conflicts[0]!
    throw new CrudHttpError(400, {
      error: t('errors.conflicting_field', 'This field was sent twice with different values.'),
      fields: inspection.conflicts.map((entry) => entry.snake),
      details: `${first.snake} and ${first.camel} were both sent with different values.`,
    })
  }

  const immutable = inspection.unwritable.filter((entry) => entry.reason === 'immutable')
  if (immutable.length > 0) {
    throw new CrudHttpError(400, {
      error: t('errors.immutable_field', 'This field cannot be changed after creation.'),
      fields: immutable.map((entry) => entry.key),
    })
  }

  const unknown = inspection.unwritable.filter((entry) => entry.reason === 'unknown')
  if (config?.rejectUnknownFields && unknown.length > 0) {
    throw new CrudHttpError(400, {
      error: t('errors.unknown_field', 'This field is not writable on this endpoint.'),
      fields: unknown.map((entry) => entry.key),
    })
  }

  const aliasing = config?.aliasSnakeCaseKeys !== false
  return {
    body: aliasing ? { ...inspection.payload, ...passthrough } : body,
    ignoredFields: unknown,
    // Returned so a caller holding keys the guard never saw (custom fields, say)
    // can apply the same renames to its own copy of the body.
    aliased: aliasing ? inspection.aliased : [],
  }
}
