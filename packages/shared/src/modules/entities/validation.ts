import { z } from 'zod'

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
  z.object({ rule: z.literal('regex'), param: z.string().min(1), message: z.string().min(1) }),
])

export type ValidationRule = z.infer<typeof validationRuleSchema>

export const validationRulesArraySchema = z.array(validationRuleSchema).max(32)

export type CustomFieldDefLike = {
  key: string
  kind: string
  configJson?: any
}

// Evaluate a single rule against a value
function evalRule(rule: ValidationRule, value: any, kind: string): string | null {
  const isEmpty = (v: any) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

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
      try {
        const re = new RegExp((rule as any).param)
        return re.test(String(value)) ? null : rule.message
      } catch {
        // Invalid regex in definition: consider it failed safe and return message
        return rule.message
      }
    default:
      return null
  }
}

export function validateValuesAgainstDefs(
  values: Record<string, any>,
  defs: CustomFieldDefLike[],
): { ok: boolean; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {}
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

