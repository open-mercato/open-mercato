import { createHash } from 'node:crypto'

export const RULE_DEFINITION_HASH_VERSION = 1

export type RuleDefinitionSource = {
  ruleType: string
  entityType: string
  eventType?: string | null
  conditionExpression?: unknown
  successActions?: unknown
  failureActions?: unknown
  effectiveFrom?: Date | string | null
  effectiveTo?: Date | string | null
  enabled?: boolean | null
}

const CIRCULAR_MARKER = '"[Circular]"'

function normalizeDateValue(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string | undefined {
  if (value === null) return 'null'
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(normalizeDateValue(value))
  if (typeof value !== 'object') return undefined
  if (ancestors.has(value)) return CIRCULAR_MARKER
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => serializeCanonical(item, ancestors) ?? 'null')
      return `[${items.join(',')}]`
    }
    const record = value as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      const serialized = serializeCanonical(record[key], ancestors)
      if (serialized === undefined) continue
      entries.push(`${JSON.stringify(key)}:${serialized}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalizeRuleDefinition(rule: RuleDefinitionSource): string {
  const definition = {
    hashVersion: RULE_DEFINITION_HASH_VERSION,
    ruleType: rule.ruleType ?? null,
    entityType: rule.entityType ?? null,
    eventType: rule.eventType ?? null,
    conditionExpression: rule.conditionExpression ?? null,
    successActions: rule.successActions ?? null,
    failureActions: rule.failureActions ?? null,
    effectiveFrom: normalizeDateValue(rule.effectiveFrom),
    effectiveTo: normalizeDateValue(rule.effectiveTo),
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : null,
  }
  return serializeCanonical(definition, new Set<object>()) ?? 'null'
}

export type RuleDefinitionHashSource = RuleDefinitionSource & {
  updatedAt?: Date | string | null
  version?: number | null
}

type RuleDefinitionHashMemo = {
  fingerprint: readonly unknown[]
  hash: string
}

const ruleDefinitionHashMemo = new WeakMap<object, RuleDefinitionHashMemo>()

function toComparableTime(value: Date | string | null | undefined): number | string | null {
  if (value instanceof Date) return value.getTime()
  return value ?? null
}

function buildRuleDefinitionFingerprint(rule: RuleDefinitionHashSource): readonly unknown[] {
  return [
    toComparableTime(rule.updatedAt),
    rule.version ?? null,
    rule.ruleType,
    rule.entityType,
    rule.eventType,
    rule.conditionExpression,
    rule.successActions,
    rule.failureActions,
    toComparableTime(rule.effectiveFrom),
    toComparableTime(rule.effectiveTo),
    rule.enabled,
  ]
}

function isSameFingerprint(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

export function computeRuleDefinitionHash(rule: RuleDefinitionHashSource): string {
  const fingerprint = buildRuleDefinitionFingerprint(rule)
  const memo = ruleDefinitionHashMemo.get(rule)
  if (memo && isSameFingerprint(memo.fingerprint, fingerprint)) return memo.hash
  const hash = createHash('sha256').update(canonicalizeRuleDefinition(rule)).digest('hex')
  ruleDefinitionHashMemo.set(rule, { fingerprint, hash })
  return hash
}
