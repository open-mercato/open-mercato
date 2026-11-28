const NUMERIC_RULES = new Set(['lt', 'lte', 'gt', 'gte'])
const KIND_DEPENDENT_RULES = new Set(['eq', 'ne'])
const NUMERIC_FIELD_KINDS = new Set(['integer', 'float'])

type RuleLike = { rule?: unknown; param?: unknown }

export function ruleTakesNumericParam(rule: unknown, kind: string): boolean {
  if (typeof rule !== 'string') return false
  if (NUMERIC_RULES.has(rule)) return true
  return KIND_DEPENDENT_RULES.has(rule) && NUMERIC_FIELD_KINDS.has(kind)
}

function normalizeRuleParam(rule: unknown, kind: string, param: unknown): unknown {
  if (typeof param !== 'string' || !ruleTakesNumericParam(rule, kind)) return param
  const trimmed = param.trim()
  const numeric = trimmed === '' ? Number.NaN : Number(trimmed)
  if (Number.isFinite(numeric)) return numeric
  return typeof rule === 'string' && NUMERIC_RULES.has(rule) ? 0 : param
}

export function normalizeValidationRuleParams<TRule extends RuleLike>(rules: TRule[], kind: string): TRule[] {
  let changed = false
  const next = rules.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const param = normalizeRuleParam(entry.rule, kind, entry.param)
    if (Object.is(param, entry.param)) return entry
    changed = true
    return { ...entry, param }
  })
  return changed ? next : rules
}
