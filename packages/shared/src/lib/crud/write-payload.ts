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
  /**
   * `unknown` — no such field.
   * `immutable` — a real field that cannot be changed after creation.
   * `misspelled` — the snake_case spelling of a field the schema declares in
   *   camelCase, reported only when aliasing is switched off. With aliasing on
   *   these are applied instead, so this reason never appears.
   */
  reason: 'unknown' | 'immutable' | 'misspelled'
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

/**
 * Tenant and organization scope, in both spellings.
 *
 * These are derived from trusted context, not from the body: `.ai/review-checklist.md`
 * §4 requires handlers to ignore same-named payload fields. Two reasons they must
 * sit outside the guard entirely:
 *
 *  - `withScopedPayload` injects `organizationId` BEFORE the guard runs, so a
 *    round-tripped record carrying the `organization_id` a list endpoint emitted
 *    arrives with both spellings present. Inspecting them raised an ambiguity 400
 *    on a request that used to succeed, and did so on the "all organizations"
 *    selection where the injected value legitimately differs from the record's.
 *  - Aliasing them would be worse than the 400: it would let a caller steer scope
 *    through the snake_case spelling, which today is ignored.
 *
 * Dropping them silently is the documented contract here, not a silent drop of
 * data the caller was entitled to write.
 */
const SCOPE_KEYS = new Set(['tenantId', 'organizationId', 'tenant_id', 'organization_id'])

export function isScopeKey(key: string): boolean {
  return SCOPE_KEYS.has(key)
}

/**
 * Are the two spellings carrying the same value?
 *
 * Reference equality alone reports a conflict for structurally identical arrays or
 * objects (`tagIds: ['a']` and `tag_ids: ['a']` are `!==`), which would answer 400
 * telling the caller their values differ when they do not. Shallow structural
 * comparison covers the shapes that actually travel in a write payload.
 */
function sameWriteValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const leftKeys = Object.keys(left)
    if (leftKeys.length !== Object.keys(right).length) return false
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key])
  }
  return false
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
      if (!sameWriteValue(source[camel], source[key])) conflicts.push({ camel, snake: key })
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
 * Where the guard's findings ride on a parsed command input.
 *
 * A Symbol rather than a string key because that input reaches `commandBus.execute`,
 * the mutation guard's `mutationPayload`, sync-event payloads and action-log
 * snapshots. A string key would show up in all of them as a field no command schema
 * declares; a Symbol is skipped by `JSON.stringify` and `Object.keys`, so the report
 * travels to the route's `response` callback and nowhere else.
 */
export const IGNORED_FIELDS = Symbol.for('openMercato.crud.ignoredFields')

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
  if (!input || typeof input !== 'object') return payload
  const carrier = input as Record<string | symbol, unknown>
  const ignored = (carrier[IGNORED_FIELDS] ?? carrier.ignoredFields) as UnwritableKey[] | undefined
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
  /**
   * Optional i18n hook plus the message keys to look up.
   *
   * `@open-mercato/shared` ships no locale files, so passing a literal key argument
   * to the translate function here would name a key no dictionary can declare, and
   * `yarn i18n:check-usage` fails on exactly that. Callers that want translated messages pass their own
   * module-namespaced keys (`customers.errors.immutable_field`), which is the same
   * shape `ScopedPayloadOptions.messages` already uses. Without them the English
   * fallbacks are returned verbatim, which is what every caller does today.
   */
  translate?: (key: string, fallback?: string) => string
  messages?: {
    conflictingField?: { key: string; fallback?: string }
    immutableField?: { key: string; fallback?: string }
    unknownField?: { key: string; fallback?: string }
  }
}

const WRITE_GUARD_FALLBACKS = {
  conflictingField: 'This field was sent twice with different values.',
  immutableField: 'This field cannot be changed after creation.',
  unknownField: 'This field is not writable on this endpoint.',
} as const

function resolveGuardMessage(
  config: CrudWriteGuardConfig | undefined,
  name: keyof typeof WRITE_GUARD_FALLBACKS
): string {
  const fallback = WRITE_GUARD_FALLBACKS[name]
  const override = config?.messages?.[name]
  if (!override) return fallback
  const translate = config?.translate
  if (!translate) return override.fallback ?? fallback
  return translate(override.key, override.fallback ?? fallback)
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
  const source = body as Record<string, unknown>
  const declarable: Record<string, unknown> = {}
  const passthrough: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (isCustomFieldKey(key) || isScopeKey(key)) passthrough[key] = value
    else declarable[key] = value
  }
  const inspection = inspectWritePayload(declarable, collectWritableKeys(schema), {
    immutableFields: config?.immutableFields,
  })

  if (inspection.conflicts.length > 0) {
    const first = inspection.conflicts[0]!
    throw new CrudHttpError(400, {
      error: resolveGuardMessage(config, 'conflictingField'),
      fields: inspection.conflicts.map((entry) => entry.snake),
      details: `${first.snake} and ${first.camel} were both sent with different values.`,
    })
  }

  const immutable = inspection.unwritable.filter((entry) => entry.reason === 'immutable')
  if (immutable.length > 0) {
    throw new CrudHttpError(400, {
      error: resolveGuardMessage(config, 'immutableField'),
      fields: immutable.map((entry) => entry.key),
    })
  }

  const unknown = inspection.unwritable.filter((entry) => entry.reason === 'unknown')
  if (config?.rejectUnknownFields && unknown.length > 0) {
    throw new CrudHttpError(400, {
      error: resolveGuardMessage(config, 'unknownField'),
      fields: unknown.map((entry) => entry.key),
    })
  }

  const aliasing = config?.aliasSnakeCaseKeys !== false
  // With aliasing off the original body still spells the key snake_case, so Zod
  // strips it. Report it, or switching the flag off would reintroduce exactly the
  // silent drop this guard exists to remove.
  const reported: UnwritableKey[] = aliasing
    ? unknown
    : [...unknown, ...inspection.aliased.map((entry) => ({ key: entry.from, reason: 'misspelled' as const }))]
  return {
    body: aliasing ? { ...inspection.payload, ...passthrough } : body,
    ignoredFields: reported,
    // Returned so a caller holding keys the guard never saw (custom fields, say)
    // can apply the same renames to its own copy of the body.
    aliased: aliasing ? inspection.aliased : [],
  }
}
