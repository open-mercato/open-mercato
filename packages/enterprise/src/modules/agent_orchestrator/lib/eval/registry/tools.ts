import { z } from 'zod'
import type { Json, ScorerDefinition, ScorerToolCallView } from '../types'
import { SKIP_REASON, skipped } from '../types'
import { baseConfigSchema, jsonSubsetMatch, matchesNameOrPattern, verdict } from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

/**
 * Trajectory assertions — the closest existing art is promptfoo's `trajectory:*`
 * family, which this mirrors. They score HOW the agent got to its answer, which is
 * the dimension output-only scorers cannot see.
 */

const nameOrPatternFields = [
  {
    name: 'name',
    kind: 'text' as const,
    labelKey: `${I18N}.field.toolName`,
    hintKey: `${I18N}.field.toolName.hint`,
    // Naming a tool the agent cannot call makes the assertion silently
    // unsatisfiable, and nothing else in the form would catch the typo.
    suggest: 'tool' as const,
  },
  {
    name: 'pattern',
    kind: 'text' as const,
    labelKey: `${I18N}.field.toolPattern`,
    hintKey: `${I18N}.field.toolPattern.hint`,
    placeholderKey: `${I18N}.field.toolPattern.placeholder`,
  },
]

function selectCalls(
  calls: ReadonlyArray<ScorerToolCallView>,
  name?: string,
  pattern?: string,
): ScorerToolCallView[] {
  return calls.filter((call) => matchesNameOrPattern(call.toolName, name, pattern))
}

const toolUsedConfig = baseConfigSchema.extend({
  name: z.string().optional(),
  pattern: z.string().optional(),
  min: z.number().int().min(0).default(1),
  max: z.number().int().min(0).optional(),
})
export type ToolUsedConfig = z.infer<typeof toolUsedConfig>

export const toolUsed: ScorerDefinition<ToolUsedConfig> = {
  scorerKey: 'tool_used',
  labelKey: `${I18N}.tool_used`,
  group: 'tools',
  kind: 'deterministic',
  configSchema: toolUsedConfig,
  fields: [
    ...nameOrPatternFields,
    {
      name: 'min',
      kind: 'number',
      labelKey: `${I18N}.tool_used.field.min`,
      hintKey: `${I18N}.tool_used.field.min.hint`,
      min: 0,
      default: 1,
    },
    {
      name: 'max',
      kind: 'number',
      labelKey: `${I18N}.tool_used.field.max`,
      hintKey: `${I18N}.tool_used.field.max.hint`,
      min: 0,
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    if (!config.name && !config.pattern) {
      return skipped(SKIP_REASON.invalidConfig, { reason: 'name or pattern is required' })
    }
    const matched = selectCalls(run.toolCalls, config.name, config.pattern)
    const count = matched.length
    const withinMin = count >= config.min
    const withinMax = config.max === undefined || count <= config.max
    const passed = withinMin && withinMax
    return verdict(passed, passed ? 1 : 0, { count, min: config.min, max: config.max ?? null })
  },
}

const toolCountConfig = baseConfigSchema.extend({
  pattern: z.string().optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
})
export type ToolCountConfig = z.infer<typeof toolCountConfig>

export const toolCount: ScorerDefinition<ToolCountConfig> = {
  scorerKey: 'tool_count',
  labelKey: `${I18N}.tool_count`,
  group: 'tools',
  kind: 'deterministic',
  configSchema: toolCountConfig,
  fields: [
    {
      name: 'pattern',
      kind: 'text',
      labelKey: `${I18N}.field.toolPattern`,
      hintKey: `${I18N}.tool_count.field.pattern.hint`,
      placeholderKey: `${I18N}.field.toolPattern.placeholder`,
    },
    {
      name: 'min',
      kind: 'number',
      labelKey: `${I18N}.tool_count.field.min`,
      hintKey: `${I18N}.tool_count.field.min.hint`,
      min: 0,
    },
    {
      name: 'max',
      kind: 'number',
      labelKey: `${I18N}.tool_count.field.max`,
      hintKey: `${I18N}.tool_count.field.max.hint`,
      min: 0,
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    if (config.min === undefined && config.max === undefined) {
      return skipped(SKIP_REASON.invalidConfig, { reason: 'min or max is required' })
    }
    const count = config.pattern ? selectCalls(run.toolCalls, undefined, config.pattern).length : run.toolCalls.length
    const withinMin = config.min === undefined || count >= config.min
    const withinMax = config.max === undefined || count <= config.max
    const passed = withinMin && withinMax
    return verdict(passed, passed ? 1 : 0, { count, min: config.min ?? null, max: config.max ?? null })
  },
}

const toolArgsMatchConfig = baseConfigSchema.extend({
  name: z.string().optional(),
  pattern: z.string().optional(),
  args: z.string().min(1),
  mode: z.enum(['partial', 'exact']).default('partial'),
  ignore: z.array(z.string()).default([]),
})
export type ToolArgsMatchConfig = z.infer<typeof toolArgsMatchConfig>

export const toolArgsMatch: ScorerDefinition<ToolArgsMatchConfig> = {
  scorerKey: 'tool_args_match',
  labelKey: `${I18N}.tool_args_match`,
  group: 'tools',
  kind: 'deterministic',
  configSchema: toolArgsMatchConfig,
  fields: [
    ...nameOrPatternFields,
    {
      name: 'args',
      kind: 'json',
      labelKey: `${I18N}.tool_args_match.field.args`,
      hintKey: `${I18N}.tool_args_match.field.args.hint`,
      required: true,
    },
    {
      name: 'mode',
      kind: 'select',
      labelKey: `${I18N}.tool_args_match.field.mode`,
      default: 'partial',
      options: [
        { value: 'partial', labelKey: `${I18N}.mode.partial` },
        { value: 'exact', labelKey: `${I18N}.mode.exact` },
      ],
    },
    { name: 'ignore', kind: 'string-list', labelKey: `${I18N}.json_match.field.ignore` },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    if (!config.name && !config.pattern) {
      return skipped(SKIP_REASON.invalidConfig, { reason: 'name or pattern is required' })
    }
    let target: Json
    try {
      target = JSON.parse(config.args) as Json
    } catch {
      return skipped(SKIP_REASON.invalidConfig, { reason: 'args is not valid JSON' })
    }

    const candidates = selectCalls(run.toolCalls, config.name, config.pattern)
    if (!candidates.length) {
      return verdict(false, 0, { reason: 'tool was never called' })
    }

    // Passes when ANY matching call satisfies the argument expectation — an agent
    // may legitimately call the same tool several times.
    const hit = candidates.find((call) => {
      if (config.mode === 'exact') {
        return jsonSubsetMatch(call.args, target, config.ignore).matched
          && jsonSubsetMatch(target, call.args, config.ignore).matched
      }
      return jsonSubsetMatch(call.args, target, config.ignore).matched
    })

    if (hit) return verdict(true, 1, { calls: candidates.length, mode: config.mode })

    const closest = jsonSubsetMatch(candidates[0]?.args ?? null, target, config.ignore).mismatches
    return verdict(false, 0, { calls: candidates.length, mode: config.mode, mismatches: closest })
  },
}

const toolSequenceConfig = baseConfigSchema.extend({
  steps: z.array(z.string().min(1)).min(1),
  order: z.enum(['in_order', 'exact']).default('in_order'),
})
export type ToolSequenceConfig = z.infer<typeof toolSequenceConfig>

export const toolSequence: ScorerDefinition<ToolSequenceConfig> = {
  scorerKey: 'tool_sequence',
  labelKey: `${I18N}.tool_sequence`,
  group: 'tools',
  kind: 'deterministic',
  configSchema: toolSequenceConfig,
  fields: [
    {
      name: 'steps',
      kind: 'string-list',
      labelKey: `${I18N}.tool_sequence.field.steps`,
      hintKey: `${I18N}.tool_sequence.field.steps.hint`,
      suggest: 'tool',
      required: true,
    },
    {
      name: 'order',
      kind: 'select',
      labelKey: `${I18N}.tool_sequence.field.order`,
      default: 'in_order',
      options: [
        { value: 'in_order', labelKey: `${I18N}.order.in_order` },
        { value: 'exact', labelKey: `${I18N}.order.exact` },
      ],
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const actual = [...run.toolCalls].sort((a, b) => a.sequence - b.sequence).map((call) => call.toolName)

    if (config.order === 'exact') {
      const passed =
        actual.length === config.steps.length &&
        actual.every((toolName, index) => matchesNameOrPattern(toolName, undefined, config.steps[index]))
      return verdict(passed, passed ? 1 : 0, { actual, expected: config.steps })
    }

    // in_order: every step appears, in the given relative order, extras allowed.
    let cursor = 0
    for (const toolName of actual) {
      if (cursor < config.steps.length && matchesNameOrPattern(toolName, undefined, config.steps[cursor])) cursor += 1
    }
    const passed = cursor === config.steps.length
    return {
      passed,
      score: config.steps.length ? cursor / config.steps.length : 1,
      evidence: { actual, expected: config.steps, matchedSteps: cursor },
    }
  },
}

export const toolScorers = [toolUsed, toolArgsMatch, toolSequence, toolCount] as const
