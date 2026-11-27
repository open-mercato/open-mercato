import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  mergeCallSettings,
  type AiAgentCallSettings,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { AgentRun, AgentSpan } from '../../../data/entities'
import { readLlmSpanMetadata } from '../../trace/genAiAttributes'
import type { EvalScope } from '../evalReplayService'
import type { EvalRunToolSummary } from '../evalRunSettings'
import type { EvalReport } from './reportSchema'

export const EVAL_REPORT_RUN_TREE_MAX_DEPTH = 10
export const EVAL_REPORT_RUN_TREE_MAX_RUNS = 5000

export const TOOL_FIXTURE_SUMMARY_FIDELITY_WARNING = 'tool_fixture_summary_fidelity'

export type EvalReportModelSettings = EvalReport['environment']['modelSettings']
export type SeedHonored = 'yes' | 'no' | 'unknown'

export type RecordedLlmCall = { seed?: number; providerName?: string }

/**
 * The settings an eval run's model calls were made with, in runtime precedence:
 * eval-run `callSettings` over the agent's `modelSettings` over the provider
 * default (absent). Provider options never reach the report (they can carry
 * credentials or end-user ids); only the fact that they were set is kept.
 */
export function resolveEffectiveModelSettings(
  definitionSettings: AiAgentCallSettings | null | undefined,
  callSettings: AiAgentCallSettings | null | undefined,
): AiAgentCallSettings {
  return mergeCallSettings(definitionSettings ?? undefined, callSettings ?? undefined)
}

/**
 * `yes` when every llm span that recorded request parameters carries the
 * requested seed, `no` when any of them carries another seed or none, and
 * `unknown` when no llm span recorded request parameters at all.
 */
export function resolveSeedHonored(requested: number, calls: ReadonlyArray<RecordedLlmCall>): SeedHonored {
  if (!calls.length) return 'unknown'
  return calls.every((call) => call.seed === requested) ? 'yes' : 'no'
}

export function buildReportModelSettings(
  effective: AiAgentCallSettings,
  calls: ReadonlyArray<RecordedLlmCall>,
): EvalReportModelSettings {
  const settings: EvalReportModelSettings = {}
  if (effective.temperature !== undefined) settings.temperature = effective.temperature
  if (effective.seed !== undefined) {
    settings.seed = { requested: effective.seed, honored: resolveSeedHonored(effective.seed, calls) }
  }
  if (effective.topP !== undefined) settings.topP = effective.topP
  if (effective.topK !== undefined) settings.topK = effective.topK
  if (effective.maxOutputTokens !== undefined) settings.maxOutputTokens = effective.maxOutputTokens
  if (effective.stopSequences !== undefined) settings.stopSequences = [...effective.stopSequences]
  if (effective.presencePenalty !== undefined) settings.presencePenalty = effective.presencePenalty
  if (effective.frequencyPenalty !== undefined) settings.frequencyPenalty = effective.frequencyPenalty
  if (effective.providerOptions && Object.keys(effective.providerOptions).length) {
    settings.providerOptionsPresent = true
  }
  return settings
}

export function buildEnvironmentWarnings(tools: EvalRunToolSummary | null): string[] {
  if (!tools || tools.summaryFidelityCases <= 0) return []
  return [
    `${TOOL_FIXTURE_SUMMARY_FIDELITY_WARNING}: ${tools.summaryFidelityCases} case(s) replayed tool fixtures built from a stored run (fidelity: summary); recorded tool outputs are redacted summaries, so verdicts may differ from a live or fully recorded run`,
  ]
}

/**
 * Collects the run ids of the given root runs and their delegated descendants
 * (`parentRunId` chains), bounded in depth and size, scoped to the caller.
 */
export async function collectRunTreeIds(
  em: EntityManager,
  scope: EvalScope,
  rootRunIds: ReadonlyArray<string>,
): Promise<string[]> {
  const seen = new Set<string>(rootRunIds)
  let frontier = Array.from(seen)
  for (let depth = 0; depth < EVAL_REPORT_RUN_TREE_MAX_DEPTH && frontier.length; depth += 1) {
    if (seen.size >= EVAL_REPORT_RUN_TREE_MAX_RUNS) break
    const children = await findWithDecryption(
      em,
      AgentRun,
      { parentRunId: { $in: frontier }, ...scope },
      { fields: ['id', 'parentRunId'] },
      scope,
    )
    const next: string[] = []
    for (const child of children) {
      if (seen.has(child.id) || seen.size >= EVAL_REPORT_RUN_TREE_MAX_RUNS) continue
      seen.add(child.id)
      next.push(child.id)
    }
    frontier = next
  }
  return Array.from(seen)
}

/** The llm calls of the run tree that recorded `gen_ai.*` request metadata. */
export async function loadRecordedLlmCalls(
  em: EntityManager,
  scope: EvalScope,
  runIds: ReadonlyArray<string>,
): Promise<RecordedLlmCall[]> {
  if (!runIds.length) return []
  const spans = await findWithDecryption(
    em,
    AgentSpan,
    { agentRunId: { $in: [...runIds] }, kind: 'llm', ...scope },
    { fields: ['id', 'agentRunId', 'attributes'] },
    scope,
  )
  const calls: RecordedLlmCall[] = []
  for (const span of spans) {
    const metadata = readLlmSpanMetadata(span.attributes)
    if (metadata.source !== 'gen_ai') continue
    calls.push({ seed: metadata.params.seed, providerName: metadata.providerName })
  }
  return calls
}

export function providersOf(calls: ReadonlyArray<RecordedLlmCall>): string[] {
  return Array.from(
    new Set(calls.map((call) => call.providerName).filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ).sort((left, right) => left.localeCompare(right))
}
