import type { RunParameter, RunParameterValue } from './adapter'

export type RunParameterError = {
  key: string
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
    const provided = (input as Record<string, unknown>)[param.key]
    const hasValue = !isBlank(provided)

    if (!hasValue) {
      if (param.required && param.defaultValue === undefined) {
        errors.push({ key: param.key, message: `${param.label} is required.` })
        continue
      }
      if (param.defaultValue !== undefined) {
        values[param.key] = param.defaultValue
      }
      continue
    }

    switch (param.type) {
      case 'boolean': {
        const coerced = coerceBoolean(provided)
        if (coerced === null) {
          errors.push({ key: param.key, message: `${param.label} must be a boolean.` })
          break
        }
        values[param.key] = coerced
        break
      }
      case 'number': {
        const coerced = coerceNumber(provided)
        if (coerced === null) {
          errors.push({ key: param.key, message: `${param.label} must be a number.` })
          break
        }
        if (typeof param.min === 'number' && coerced < param.min) {
          errors.push({ key: param.key, message: `${param.label} must be at least ${param.min}.` })
          break
        }
        if (typeof param.max === 'number' && coerced > param.max) {
          errors.push({ key: param.key, message: `${param.label} must be at most ${param.max}.` })
          break
        }
        values[param.key] = coerced
        break
      }
      case 'select': {
        const candidate = String(provided)
        const allowed = (param.options ?? []).map((option) => option.value)
        if (!allowed.includes(candidate)) {
          errors.push({ key: param.key, message: `${param.label} must be one of: ${allowed.join(', ')}.` })
          break
        }
        values[param.key] = candidate
        break
      }
      case 'string':
      default: {
        values[param.key] = String(provided).trim()
        break
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, values }
}
