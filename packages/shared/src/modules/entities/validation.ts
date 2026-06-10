import { z } from 'zod'
import { testLinearRegex } from '../../lib/regex/linear'

export const MAX_CUSTOM_FIELD_REGEX_PATTERN_LENGTH = 500
export const MAX_CUSTOM_FIELD_REGEX_INPUT_LENGTH = 10_000
export const MAX_CUSTOM_FIELD_KEYS_PER_RECORD = 128
export const UNKNOWN_CUSTOM_FIELD_ERROR = '[internal] Unknown custom field'
export const TOO_MANY_CUSTOM_FIELDS_ERROR = '[internal] Too many custom fields'

// Supported rule types for custom fields validation
export const VALIDATION_RULES = [
  'required',
  'date',
  'integer',
  'float',
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'ne',
  'regex',
] as const

export type ValidationRuleKind = typeof VALIDATION_RULES[number]

export const validationRuleSchema = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('required'), message: z.string().min(1) }),
  z.object({ rule: z.literal('date'), message: z.string().min(1) }),
  z.object({ rule: z.literal('integer'), message: z.string().min(1) }),
  z.object({ rule: z.literal('float'), message: z.string().min(1) }),
  z.object({ rule: z.literal('lt'), param: z.number(), message: z.string().min(1) }),
  z.object({ rule: z.literal('lte'), param: z.number(), message: z.string().min(1) }),
  z.object({ rule: z.literal('gt'), param: z.number(), message: z.string().min(1) }),
  z.object({ rule: z.literal('gte'), param: z.number(), message: z.string().min(1) }),
  z.object({ rule: z.literal('eq'), param: z.any(), message: z.string().min(1) }),
  z.object({ rule: z.literal('ne'), param: z.any(), message: z.string().min(1) }),
  z.object({
    rule: z.literal('regex'),
    param: z.string().min(1),
    message: z.string().min(1),
  }),
])

export type ValidationRule = z.infer<typeof validationRuleSchema>

export const validationRulesArraySchema = z.array(validationRuleSchema).max(32)

export type CustomFieldDefLike = {
  key: string
  kind: string
  configJson?: any
}

const isEmpty = (v: any) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

// Evaluate a single rule against a value. Multi-value fields (e.g. `text` with
// `multi: true`) carry array values; every rule except `required` is applied to
// each element so a regex like `^[a-z0-9_-]+$` is checked per tag instead of the
// comma-joined string representation.
function evalRule(rule: ValidationRule, value: any, kind: string): string | null {
  if (rule.rule === 'required') {
    return isEmpty(value) ? rule.message : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const msg = evalScalarRule(rule, item, kind)
      if (msg) return msg
    }
    return null
  }
  return evalScalarRule(rule, value, kind)
}

// Evaluate a single rule against a scalar (non-array) value.
function evalScalarRule(rule: ValidationRule, value: any, kind: string): string | null {
  switch (rule.rule) {
    case 'required':
      return isEmpty(value) ? rule.message : null
    case 'date': {
      if (isEmpty(value)) return null
      const d = new Date(String(value))
      return isNaN(d.getTime()) ? rule.message : null
    }
    case 'integer': {
      if (isEmpty(value)) return null
      const n = Number(value)
      return Number.isInteger(n) ? null : rule.message
    }
    case 'float': {
      if (isEmpty(value)) return null
      const n = Number(value)
      return Number.isFinite(n) ? null : rule.message
    }
    case 'lt':
      if (isEmpty(value)) return null
      return Number(value) < (rule as any).param ? null : rule.message
    case 'lte':
      if (isEmpty(value)) return null
      return Number(value) <= (rule as any).param ? null : rule.message
    case 'gt':
      if (isEmpty(value)) return null
      return Number(value) > (rule as any).param ? null : rule.message
    case 'gte':
      if (isEmpty(value)) return null
      return Number(value) >= (rule as any).param ? null : rule.message
    case 'eq':
      if (isEmpty(value)) return null
      return value === (rule as any).param ? null : rule.message
    case 'ne':
      if (isEmpty(value)) return null
      return value !== (rule as any).param ? null : rule.message
    case 'regex':
      if (isEmpty(value)) return null
      const regexResult = testLinearRegex(String((rule as any).param), String(value), {
        maxPatternLength: MAX_CUSTOM_FIELD_REGEX_PATTERN_LENGTH,
        maxInputLength: MAX_CUSTOM_FIELD_REGEX_INPUT_LENGTH,
      })
      return regexResult.ok && regexResult.matched ? null : rule.message
    default:
      return null
  }
}

function countPresentValueKeys(values: Record<string, unknown>): number {
  let count = 0
  for (const key of Object.keys(values)) {
    if (values[key] !== undefined) count++
  }
  return count
}

export type ValidateValuesOptions = {
  // When true, value keys that have no matching CustomFieldDef are rejected
  // (OWASP A03/A04 EAV mass-assignment guard for untrusted entry points such as
  // the generic `/api/entities/records` endpoint). Trusted first-party command
  // writes persist dynamic/internal keys, so they leave this off and rely on the
  // always-on per-record key cap below as the unbounded-injection backstop.
  rejectUndeclaredKeys?: boolean
}

export function validateValuesAgainstDefs(
  values: Record<string, any>,
  defs: CustomFieldDefLike[],
  options: ValidateValuesOptions = {},
): { ok: boolean; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (options.rejectUndeclaredKeys) {
    const allowedKeys = new Set(defs.map((def) => def.key))
    for (const key of Object.keys(values)) {
      if (values[key] === undefined) continue
      if (!allowedKeys.has(key)) {
        errors[`cf_${key}`] = UNKNOWN_CUSTOM_FIELD_ERROR
      }
    }
  }

  if (countPresentValueKeys(values) > MAX_CUSTOM_FIELD_KEYS_PER_RECORD) {
    errors._customFields = TOO_MANY_CUSTOM_FIELDS_ERROR
  }

  for (const def of defs) {
    const cfg = def?.configJson || {}
    const rules: ValidationRule[] = Array.isArray(cfg.validation) ? cfg.validation : []
    if (rules.length === 0) continue
    const value = values[def.key]
    for (const r of rules) {
      const msg = evalRule(r as any, value, def.kind)
      if (msg) {
        errors[`cf_${def.key}`] = msg
        break
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, fieldErrors: errors }
}
