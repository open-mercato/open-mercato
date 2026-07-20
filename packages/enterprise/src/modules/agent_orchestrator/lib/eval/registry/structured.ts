import { z } from 'zod'
import type { Json, ScorerDefinition } from '../types'
import { SKIP_REASON, skipped } from '../types'
import {
  baseConfigSchema,
  jsonEquals,
  jsonSubsetMatch,
  resolvePath,
  sourceSchema,
  subsetScore,
  verdict,
} from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

const jsonValidConfig = baseConfigSchema.extend({ path: z.string().optional() })
export type JsonValidConfig = z.infer<typeof jsonValidConfig>

export const jsonValid: ScorerDefinition<JsonValidConfig> = {
  scorerKey: 'json_valid',
  labelKey: `${I18N}.json_valid`,
  group: 'structured',
  kind: 'deterministic',
  configSchema: jsonValidConfig,
  fields: [{ name: 'path', kind: 'text', labelKey: `${I18N}.field.path`, hintKey: `${I18N}.field.path.hint` }],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const value = resolvePath(run.output, config.path)
    if (typeof value === 'string') {
      try {
        JSON.parse(value)
        return verdict(true, 1)
      } catch {
        return verdict(false, 0, { reason: 'string is not parseable JSON' })
      }
    }
    const structured = value !== null && typeof value === 'object'
    return verdict(structured, structured ? 1 : 0, structured ? undefined : { reason: 'value is not an object' })
  },
}

const jsonSchemaConfig = baseConfigSchema.extend({
  schema: z.string().min(1),
  path: z.string().optional(),
})
export type JsonSchemaConfig = z.infer<typeof jsonSchemaConfig>

/**
 * Structural validation against a JSON Schema subset (type / required / properties).
 * Deliberately not a full JSON Schema engine: a new validator dependency for the
 * gate tier would widen the trusted surface, and the shapes agents emit are
 * already constrained by their registered output schema.
 */
export const jsonSchema: ScorerDefinition<JsonSchemaConfig> = {
  scorerKey: 'json_schema',
  labelKey: `${I18N}.json_schema`,
  group: 'structured',
  kind: 'deterministic',
  configSchema: jsonSchemaConfig,
  fields: [
    {
      name: 'schema',
      kind: 'json',
      labelKey: `${I18N}.json_schema.field.schema`,
      hintKey: `${I18N}.json_schema.field.schema.hint`,
      required: true,
    },
    { name: 'path', kind: 'text', labelKey: `${I18N}.field.path`, hintKey: `${I18N}.field.path.hint` },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    let parsed: Record<string, Json>
    try {
      parsed = JSON.parse(config.schema) as Record<string, Json>
    } catch {
      return skipped(SKIP_REASON.invalidConfig, { reason: 'schema is not valid JSON' })
    }
    const value = resolvePath(run.output, config.path)
    const problems = validateAgainstSchema(value, parsed, '')
    return {
      passed: problems.length === 0,
      score: problems.length === 0 ? 1 : 0,
      evidence: problems.length ? { problems } : undefined,
    }
  },
}

function validateAgainstSchema(value: Json | null, schema: Record<string, Json>, path: string): string[] {
  const problems: string[] = []
  const label = path || '.'
  const expectedType = typeof schema.type === 'string' ? schema.type : null

  if (expectedType) {
    const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const normalized = actualType === 'number' && expectedType === 'integer' ? 'integer' : actualType
    if (normalized !== expectedType) problems.push(`${label}: expected ${expectedType}, got ${actualType}`)
  }

  if (Array.isArray(schema.required) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required as Json[]) {
      if (typeof key === 'string' && !(key in (value as Record<string, Json>))) {
        problems.push(`${label}: missing required "${key}"`)
      }
    }
  }

  const properties = schema.properties
  if (properties && typeof properties === 'object' && value !== null && typeof value === 'object') {
    for (const [key, childSchema] of Object.entries(properties as Record<string, Json>)) {
      const child = (value as Record<string, Json>)[key]
      if (child === undefined) continue
      if (childSchema && typeof childSchema === 'object' && !Array.isArray(childSchema)) {
        problems.push(
          ...validateAgainstSchema(child, childSchema as Record<string, Json>, path ? `${path}.${key}` : key),
        )
      }
    }
  }

  return problems
}

const jsonMatchConfig = baseConfigSchema.extend({
  value: z.string().optional(),
  path: z.string().optional(),
  mode: z.enum(['exact', 'subset']).default('subset'),
  ignore: z.array(z.string()).default([]),
  source: sourceSchema,
})
export type JsonMatchConfig = z.infer<typeof jsonMatchConfig>

/**
 * Defaults to `mode: 'subset'` — an eval case's expected payload rarely enumerates
 * every field, and exact equality would make the correction flywheel useless.
 */
export const jsonMatch: ScorerDefinition<JsonMatchConfig> = {
  scorerKey: 'json_match',
  labelKey: `${I18N}.json_match`,
  group: 'structured',
  kind: 'deterministic',
  configSchema: jsonMatchConfig,
  fields: [
    {
      name: 'source',
      kind: 'select',
      labelKey: `${I18N}.field.source`,
      hintKey: `${I18N}.field.source.hint`,
      default: 'expected',
      options: [
        { value: 'expected', labelKey: `${I18N}.source.expected` },
        { value: 'config', labelKey: `${I18N}.source.config` },
      ],
    },
    { name: 'value', kind: 'json', labelKey: `${I18N}.json_match.field.value`, hintKey: `${I18N}.field.value.hint` },
    { name: 'path', kind: 'text', labelKey: `${I18N}.field.path`, hintKey: `${I18N}.field.path.hint` },
    {
      name: 'mode',
      kind: 'select',
      labelKey: `${I18N}.json_match.field.mode`,
      default: 'subset',
      options: [
        { value: 'subset', labelKey: `${I18N}.mode.subset` },
        { value: 'exact', labelKey: `${I18N}.mode.exact` },
      ],
    },
    { name: 'ignore', kind: 'string-list', labelKey: `${I18N}.json_match.field.ignore`, hintKey: `${I18N}.json_match.field.ignore.hint` },
  ],
  needsExpected: (config) => config.source === 'expected',
  score: (run, expected, config) => {
    let target: Json | null
    if (config.source === 'config') {
      if (!config.value) return skipped(SKIP_REASON.invalidConfig, { reason: 'no comparison value' })
      try {
        target = JSON.parse(config.value) as Json
      } catch {
        return skipped(SKIP_REASON.invalidConfig, { reason: 'value is not valid JSON' })
      }
    } else {
      if (expected === null) return skipped(SKIP_REASON.noExpected)
      target = resolvePath(expected, config.path)
    }

    const actual = resolvePath(run.output, config.path)

    if (config.mode === 'exact') {
      const matched = jsonEquals(actual, target)
      return verdict(matched, matched ? 1 : 0, matched ? undefined : { reason: 'values differ' })
    }

    const { matched, mismatches, mismatchedLeaves, comparedLeaves } = jsonSubsetMatch(actual, target, config.ignore)
    return {
      passed: matched,
      // Denominator is what was actually COMPARED, not the target's leaf count:
      // arrays compare as one unit and ignored paths are not compared at all.
      score: subsetScore(mismatchedLeaves, comparedLeaves),
      evidence: mismatches.length ? { mismatches } : undefined,
    }
  },
}

const jsonPathCompareConfig = baseConfigSchema.extend({
  path: z.string().min(1),
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
  value: z.string(),
})
export type JsonPathCompareConfig = z.infer<typeof jsonPathCompareConfig>

export const jsonPathCompare: ScorerDefinition<JsonPathCompareConfig> = {
  scorerKey: 'json_path_compare',
  labelKey: `${I18N}.json_path_compare`,
  group: 'structured',
  kind: 'deterministic',
  configSchema: jsonPathCompareConfig,
  fields: [
    {
      name: 'path',
      kind: 'text',
      labelKey: `${I18N}.field.path`,
      hintKey: `${I18N}.field.path.hint`,
      required: true,
    },
    {
      name: 'operator',
      kind: 'select',
      labelKey: `${I18N}.json_path_compare.field.operator`,
      required: true,
      options: (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const).map((op) => ({
        value: op,
        labelKey: `${I18N}.operator.${op}`,
      })),
    },
    {
      name: 'value',
      kind: 'text',
      labelKey: `${I18N}.json_path_compare.field.value`,
      hintKey: `${I18N}.json_path_compare.field.value.hint`,
      required: true,
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const actual = resolvePath(run.output, config.path)
    const passed = applyOperator(actual, config.operator, config.value)
    return verdict(passed, passed ? 1 : 0, { actual, operator: config.operator, value: config.value })
  },
}

function applyOperator(actual: Json | null, operator: JsonPathCompareConfig['operator'], raw: string): boolean {
  if (operator === 'in') {
    const options = raw.split(',').map((item) => item.trim())
    return options.includes(String(actual))
  }
  if (operator === 'contains') {
    if (Array.isArray(actual)) return actual.some((item) => String(item) === raw)
    return String(actual ?? '').includes(raw)
  }
  if (operator === 'eq') return String(actual) === raw
  if (operator === 'ne') return String(actual) !== raw

  const left = typeof actual === 'number' ? actual : Number(actual)
  const right = Number(raw)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  if (operator === 'gt') return left > right
  if (operator === 'gte') return left >= right
  if (operator === 'lt') return left < right
  return left <= right
}

export const structuredScorers = [jsonValid, jsonSchema, jsonMatch, jsonPathCompare] as const
