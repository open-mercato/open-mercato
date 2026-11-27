type Constraint = 'required' | 'pattern' | 'minLength' | 'maxLength' | 'min' | 'max'

export type CrudFormDeclarativeFieldConstraint = Readonly<{
  messageKey: string
  enforce?: 'client' | 'client-and-server'
}> & Partial<{ required: true; pattern: string; minLength: number; maxLength: number; min: number; max: number }>

type ConstraintValue = { required: true; pattern: string; minLength: number; maxLength: number; min: number; max: number }
export type CrudFormNormalizedFieldRule = {
  [Kind in Constraint]: Readonly<{
    kind: Kind
    value: ConstraintValue[Kind]
    messageKey: string
    enforce: 'client' | 'client-and-server'
  }>
}[Constraint]

const constraintNames = ['required', 'pattern', 'minLength', 'maxLength', 'min', 'max'] as const

export function normalizeCrudFormFieldRules(rules: readonly CrudFormDeclarativeFieldConstraint[]): CrudFormNormalizedFieldRule[] {
  return rules.flatMap((rule) => {
    const { messageKey, enforce = 'client' } = rule
    if (!messageKey?.trim() || (enforce !== 'client' && enforce !== 'client-and-server')) {
      throw new Error('[internal] Invalid CrudForm declarative rule message or enforcement')
    }
    const normalized: CrudFormNormalizedFieldRule[] = []
    for (const kind of constraintNames) {
      const value = rule[kind]
      if (value === undefined) continue
      if (kind === 'required' && value === true) normalized.push({ kind, value, messageKey, enforce })
      else if (kind === 'pattern' && typeof value === 'string') {
        try {
          new RegExp(value)
        } catch {
          throw new Error('[internal] Invalid CrudForm declarative rule pattern')
        }
        normalized.push({ kind, value, messageKey, enforce })
      } else if ((kind === 'minLength' || kind === 'maxLength') && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        normalized.push({ kind, value, messageKey, enforce })
      } else if ((kind === 'min' || kind === 'max') && typeof value === 'number' && Number.isFinite(value)) {
        normalized.push({ kind, value, messageKey, enforce })
      } else throw new Error(`[internal] Invalid CrudForm declarative rule ${kind}`)
    }
    if (!normalized.length) throw new Error('[internal] CrudForm declarative rule has no constraint')
    return normalized
  })
}

export function isAbsentCrudFormFieldValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0)
}

export function evaluateCrudFormFieldRules(
  value: unknown, rules: readonly CrudFormNormalizedFieldRule[], phase: 'client' | 'server',
): string | null {
  for (const rule of rules) {
    if (phase === 'server' && rule.enforce !== 'client-and-server') continue
    if (rule.kind === 'required') {
      if (isAbsentCrudFormFieldValue(value)) return rule.messageKey
      continue
    }
    if (value === undefined || value === null) continue
    switch (rule.kind) {
      case 'pattern':
        if (typeof value !== 'string' || !new RegExp(rule.value).test(value)) return rule.messageKey
        break
      case 'minLength':
        if (typeof value !== 'string' || value.length < rule.value) return rule.messageKey
        break
      case 'maxLength':
        if (typeof value !== 'string' || value.length > rule.value) return rule.messageKey
        break
      case 'min':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.value) return rule.messageKey
        break
      case 'max':
        if (typeof value !== 'number' || !Number.isFinite(value) || value > rule.value) return rule.messageKey
        break
    }
  }
  return null
}
