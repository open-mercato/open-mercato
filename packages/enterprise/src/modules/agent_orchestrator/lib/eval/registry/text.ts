import { z } from 'zod'
import type { Json, ScorerDefinition, ScorerVerdict } from '../types'
import { SKIP_REASON, skipped } from '../types'
import { baseConfigSchema, resolvePath, sourceSchema, toText, verdict } from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

/**
 * Shared config for the text family. `source` decides where the comparison target
 * comes from: the eval case's `expected` (offline only) or the assertion's own
 * `value` (works on both planes — the only mode available online).
 */
const textConfig = baseConfigSchema.extend({
  value: z.string().optional(),
  path: z.string().optional(),
  caseInsensitive: z.boolean().default(false),
  source: sourceSchema,
})
export type TextConfig = z.infer<typeof textConfig>

const textFields = (valueLabel: string) =>
  [
    {
      name: 'source',
      kind: 'select' as const,
      labelKey: `${I18N}.field.source`,
      hintKey: `${I18N}.field.source.hint`,
      default: 'expected',
      options: [
        { value: 'expected', labelKey: `${I18N}.source.expected` },
        { value: 'config', labelKey: `${I18N}.source.config` },
      ],
    },
    { name: 'value', kind: 'text' as const, labelKey: valueLabel, hintKey: `${I18N}.field.value.hint` },
    { name: 'path', kind: 'text' as const, labelKey: `${I18N}.field.path`, hintKey: `${I18N}.field.path.hint` },
    { name: 'caseInsensitive', kind: 'boolean' as const, labelKey: `${I18N}.field.caseInsensitive`, default: false },
  ] as const

function resolveTarget(expected: Json | null, config: TextConfig): { target: string | null; skip: boolean } {
  if (config.source === 'config') return { target: config.value ?? null, skip: false }
  if (expected === null) return { target: null, skip: true }
  return { target: toText(resolvePath(expected, config.path)), skip: false }
}

function normalize(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value
}

function textScorer(
  scorerKey: string,
  valueLabel: string,
  compare: (actual: string, target: string) => boolean,
): ScorerDefinition<TextConfig> {
  return {
    scorerKey,
    labelKey: `${I18N}.${scorerKey}`,
    group: 'text',
    kind: 'deterministic',
    configSchema: textConfig,
    fields: textFields(valueLabel),
    needsExpected: (config) => config.source === 'expected',
    score: (run, expected, config): ScorerVerdict => {
      const { target, skip } = resolveTarget(expected, config)
      if (skip) return skipped(SKIP_REASON.noExpected)
      if (target === null) return skipped(SKIP_REASON.invalidConfig, { reason: 'no comparison value' })
      const actual = toText(resolvePath(run.output, config.path))
      const passed = compare(
        normalize(actual, config.caseInsensitive),
        normalize(target, config.caseInsensitive),
      )
      return verdict(passed, passed ? 1 : 0, { actual, target })
    },
  }
}

export const equals = textScorer('equals', `${I18N}.equals.field.value`, (actual, target) => actual === target)

export const contains = textScorer('contains', `${I18N}.contains.field.value`, (actual, target) =>
  actual.includes(target),
)

export const startsWith = textScorer('starts_with', `${I18N}.starts_with.field.value`, (actual, target) =>
  actual.startsWith(target),
)

const regexConfig = baseConfigSchema.extend({
  pattern: z.string().min(1),
  path: z.string().optional(),
  caseInsensitive: z.boolean().default(false),
})
export type RegexConfig = z.infer<typeof regexConfig>

export const regex: ScorerDefinition<RegexConfig> = {
  scorerKey: 'regex',
  labelKey: `${I18N}.regex`,
  group: 'text',
  kind: 'deterministic',
  configSchema: regexConfig,
  fields: [
    {
      name: 'pattern',
      kind: 'text',
      labelKey: `${I18N}.regex.field.pattern`,
      hintKey: `${I18N}.regex.field.pattern.hint`,
      required: true,
    },
    { name: 'path', kind: 'text', labelKey: `${I18N}.field.path`, hintKey: `${I18N}.field.path.hint` },
    { name: 'caseInsensitive', kind: 'boolean', labelKey: `${I18N}.field.caseInsensitive`, default: false },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const actual = toText(resolvePath(run.output, config.path))
    let matched: boolean
    try {
      matched = new RegExp(config.pattern, config.caseInsensitive ? 'i' : undefined).test(actual)
    } catch {
      // A malformed pattern is a config fault, not a run failure — skip so a typo
      // cannot flip a gate verdict to false.
      return skipped(SKIP_REASON.invalidConfig, { pattern: config.pattern })
    }
    return verdict(matched, matched ? 1 : 0, { pattern: config.pattern })
  },
}

export const textScorers = [equals, contains, regex, startsWith] as const
