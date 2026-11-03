import type { RunParameter, RunParameterValue } from './adapter'

export type RunParameterErrorCode = 'required' | 'type' | 'min' | 'max' | 'select'

export type RunParameterError = {
  key: string
  /**
   * Machine-readable reason, so the client can render a translated message.
   * The dashboard maps these to `data_sync.runParameters.errors.<code>`.
   */
  code: RunParameterErrorCode
  /** Values the translated message interpolates (label, bound, option list). */
  params: { label: string; type?: string; min?: number; max?: number; options?: string }
  /**
   * Pre-rendered English sentence. Kept for non-UI callers (API clients, logs)
   * and as the client-side fallback; the UI prefers `code` + `params`.
   */
  message: string
}

export type NormalizeRunParametersResult =
  | { ok: true; values: Record<string, RunParameterValue> }
  | { ok: false; errors: RunParameterError[] }

/**
 * Keys that cannot round-trip through a plain object literal. Assigning a
 * primitive to `__proto__` is silently discarded rather than creating an own
 * property, so a parameter declared under that key would vanish between the
 * form and the adapter instead of failing loudly. Rejecting it here — the one
 * place every surface funnels through — keeps the dashboard, the default-value
 * builder and the normalizer agreeing on the same parameter set.
 *
 * (`constructor` / `prototype` assign normally and are left alone.)
 */
const RESERVED_PARAMETER_KEYS = new Set(['__proto__'])

export function isReservedRunParameterKey(key: string): boolean {
  return RESERVED_PARAMETER_KEYS.has(key)
}

/**
 * Returns the declared parameters that apply to a given run. A parameter
 * without an explicit `direction` applies to both directions; one without an
 * explicit `entityType` applies to every entity. When `entityType` is omitted
 * here (the caller does not know the run's entity), entity scoping is skipped.
 * Parameters declared under a reserved key are dropped.
 */
export function getApplicableRunParameters(
  declared: RunParameter[] | undefined,
  direction: 'import' | 'export',
  entityType?: string,
): RunParameter[] {
  if (!declared || declared.length === 0) return []
  return declared.filter((param) => {
    if (isReservedRunParameterKey(param.key)) return false
    if (param.direction && param.direction !== direction) return false
    if (param.entityType !== undefined && entityType !== undefined) {
      const allowed = Array.isArray(param.entityType) ? param.entityType : [param.entityType]
      if (!allowed.includes(entityType)) return false
    }
    return true
  })
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return null
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Validate and coerce an untrusted parameter object against an adapter's
 * declared `runParameters` for the given run direction and entity type.
 *
 * - Parameters that do not apply to the direction or entity type are ignored.
 * - Undeclared keys in the input are dropped (never passed through).
 * - Blank values fall back to `defaultValue`; a blank required value is an error.
 * - Values are coerced to the declared type; the result only contains declared keys.
 */
function buildRunParameterError(
  param: RunParameter,
  code: RunParameterErrorCode,
  extra: { type?: string; min?: number; max?: number; options?: string } = {},
): RunParameterError {
  const message = code === 'required' ? `${param.label} is required.`
    : code === 'type' ? `${param.label} must be a ${extra.type}.`
    : code === 'min' ? `${param.label} must be at least ${extra.min}.`
    : code === 'max' ? `${param.label} must be at most ${extra.max}.`
    : `${param.label} must be one of: ${extra.options}.`
  return { key: param.key, code, params: { label: param.label, ...extra }, message }
}

type CoerceResult =
  | { ok: true; value: RunParameterValue }
  | { ok: false; error: RunParameterError }

/** Coerces and range-checks one non-blank value against its declaration. */
function coerceDeclaredValue(param: RunParameter, raw: unknown): CoerceResult {
  switch (param.type) {
    case 'boolean': {
      const coerced = coerceBoolean(raw)
      if (coerced === null) return { ok: false, error: buildRunParameterError(param, 'type', { type: 'boolean' }) }
      return { ok: true, value: coerced }
    }
    case 'number': {
      const coerced = coerceNumber(raw)
      if (coerced === null) return { ok: false, error: buildRunParameterError(param, 'type', { type: 'number' }) }
      if (typeof param.min === 'number' && coerced < param.min) {
        return { ok: false, error: buildRunParameterError(param, 'min', { min: param.min }) }
      }
      if (typeof param.max === 'number' && coerced > param.max) {
        return { ok: false, error: buildRunParameterError(param, 'max', { max: param.max }) }
      }
      return { ok: true, value: coerced }
    }
    case 'select': {
      const candidate = String(raw)
      const allowed = (param.options ?? []).map((option) => option.value)
      if (!allowed.includes(candidate)) {
        return { ok: false, error: buildRunParameterError(param, 'select', { options: allowed.join(', ') }) }
      }
      return { ok: true, value: candidate }
    }
    case 'string':
    default:
      return { ok: true, value: String(raw).trim() }
  }
}

export function normalizeRunParameters(
  declared: RunParameter[] | undefined,
  direction: 'import' | 'export',
  raw: Record<string, unknown> | null | undefined,
  entityType?: string,
): NormalizeRunParametersResult {
  const params = getApplicableRunParameters(declared, direction, entityType)
  const input = raw && typeof raw === 'object' ? raw : {}
  const values: Record<string, RunParameterValue> = {}
  const errors: RunParameterError[] = []

  for (const param of params) {
    // Own-property lookup only: a parameter declared under an inherited name
    // (`constructor`, `toString`, `valueOf`) would otherwise read back the
    // inherited function instead of `undefined`, so a required check would
    // silently pass and a string parameter would coerce the function source.
    const provided = Object.prototype.hasOwnProperty.call(input, param.key)
      ? (input as Record<string, unknown>)[param.key]
      : undefined

    if (isBlank(provided)) {
      if (param.defaultValue === undefined) {
        if (param.required) errors.push(buildRunParameterError(param, 'required'))
        continue
      }
      // The declared default goes through the same checks as a submitted
      // value, so a misdeclared adapter (a `select` default outside its own
      // options, a number below its own `min`) fails loudly here rather than
      // shipping an invalid value to itself mid-run.
      const fallback = coerceDeclaredValue(param, param.defaultValue)
      if (fallback.ok) values[param.key] = fallback.value
      else errors.push(fallback.error)
      continue
    }

    const coerced = coerceDeclaredValue(param, provided)
    if (coerced.ok) values[param.key] = coerced.value
    else errors.push(coerced.error)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, values }
}
