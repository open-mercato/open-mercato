import {
  aiAgentCallSettingsSchema,
  mergeCallSettings,
  type AiAgentCallSettings,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { z } from 'zod'
import { aggregateEvalToolMode, type EvalCaseToolOutcome, type EvalToolMode } from './toolFixtures'

export const EVAL_RUN_SUMMARY_KEY = '__evalRun' as const

export type EvalRunSettings = {
  callSettings?: AiAgentCallSettings
  tools?: EvalRunToolSummary
}

const evalToolModeSchema = z.enum(['live', 'replay', 'record', 'mixed', 'unsupported_runtime'])

const caseModeCountsSchema = z.object({
  live: z.number().int().min(0),
  replay: z.number().int().min(0),
  record: z.number().int().min(0),
  mixed: z.number().int().min(0),
  unsupported_runtime: z.number().int().min(0),
})

export const evalRunToolSummarySchema = z.object({
  mode: evalToolModeSchema,
  requested: z.enum(['record', 'replay']),
  onMiss: z.enum(['error', 'live']).nullable(),
  cases: caseModeCountsSchema,
  misses: z.number().int().min(0),
  summaryFidelityCases: z.number().int().min(0),
})

export type EvalRunToolSummary = z.infer<typeof evalRunToolSummarySchema>

/**
 * Normalizes eval-run call settings to the declared keys only. Returns null when
 * nothing is set, so a run without overrides stores no `__evalRun` entry and
 * keeps the agent's `modelSettings` as the effective settings.
 */
export function normalizeEvalRunCallSettings(
  callSettings: AiAgentCallSettings | null | undefined,
): AiAgentCallSettings | null {
  if (!callSettings) return null
  const picked = mergeCallSettings(undefined, callSettings)
  return Object.keys(picked).length ? picked : null
}

export function buildEvalRunSettings(
  callSettings: AiAgentCallSettings | null | undefined,
): EvalRunSettings | null {
  const normalized = normalizeEvalRunCallSettings(callSettings)
  return normalized ? { callSettings: normalized } : null
}

/**
 * Reads the eval-run call settings stored on a suite run summary. A malformed
 * entry yields null rather than throwing: replay then falls back to the agent's
 * own `modelSettings` instead of failing every case.
 */
export function readEvalRunCallSettings(summary: unknown): AiAgentCallSettings | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const entry = (summary as Record<string, unknown>)[EVAL_RUN_SUMMARY_KEY]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const parsed = aiAgentCallSettingsSchema.safeParse((entry as Record<string, unknown>).callSettings)
  if (!parsed.success) return null
  return normalizeEvalRunCallSettings(parsed.data)
}

export type EvalCliCallSettingsResult =
  | { ok: true; value: AiAgentCallSettings | null }
  | { ok: false; message: string }

function parseCliNumber(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() === '' || !Number.isFinite(value) ? null : value
}

/** Parses the eval CLI `--temperature`/`--seed` flags into eval-run call settings. */
export function parseEvalCliCallSettings(args: { temperature?: string; seed?: string }): EvalCliCallSettingsResult {
  const settings: AiAgentCallSettings = {}
  if (args.temperature !== undefined) {
    const temperature = parseCliNumber(args.temperature)
    if (temperature === null || temperature < 0) {
      return { ok: false, message: '--temperature must be a number greater than or equal to 0' }
    }
    settings.temperature = temperature
  }
  if (args.seed !== undefined) {
    const seed = parseCliNumber(args.seed)
    if (seed === null || !Number.isInteger(seed)) {
      return { ok: false, message: '--seed must be an integer' }
    }
    settings.seed = seed
  }
  const parsed = aiAgentCallSettingsSchema.safeParse(settings)
  if (!parsed.success) return { ok: false, message: '--temperature/--seed are invalid' }
  return { ok: true, value: normalizeEvalRunCallSettings(parsed.data) }
}

/**
 * Builds the `__evalRun.tools` entry a record/replay suite run stores: the
 * requested mode, the effective suite mode (`mixed` when any case fell back to
 * live tools) and per-mode case counts. Only counts, never tool names or args.
 */
export function buildEvalRunToolSummary(
  requested: { mode: 'record' | 'replay'; onMiss?: 'error' | 'live' },
  outcomes: ReadonlyArray<EvalCaseToolOutcome>,
): EvalRunToolSummary {
  const cases: EvalRunToolSummary['cases'] = { live: 0, replay: 0, record: 0, mixed: 0, unsupported_runtime: 0 }
  for (const outcome of outcomes) cases[outcome.mode] += 1
  return {
    mode: aggregateEvalToolMode(outcomes.map((outcome) => outcome.mode)),
    requested: requested.mode,
    onMiss: requested.mode === 'replay' ? requested.onMiss ?? 'error' : null,
    cases,
    misses: outcomes.reduce((sum, outcome) => sum + outcome.misses, 0),
    summaryFidelityCases: outcomes.filter((outcome) => outcome.summaryFidelity).length,
  }
}

export function readEvalRunToolSummary(summary: unknown): EvalRunToolSummary | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const entry = (summary as Record<string, unknown>)[EVAL_RUN_SUMMARY_KEY]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const parsed = evalRunToolSummarySchema.safeParse((entry as Record<string, unknown>).tools)
  return parsed.success ? parsed.data : null
}

/** The suite run's tool mode for the report; runs without record/replay are `live`. */
export function readEvalRunToolMode(summary: unknown): EvalToolMode {
  return readEvalRunToolSummary(summary)?.mode ?? 'live'
}

/** Writes the tool summary into `summary.__evalRun`, keeping its other entries (call settings). */
export function withEvalRunToolSummary(summary: unknown, tools: EvalRunToolSummary): Record<string, unknown> {
  const base = summary && typeof summary === 'object' && !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : {}
  const existing = base[EVAL_RUN_SUMMARY_KEY]
  const current = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}
  return { ...base, [EVAL_RUN_SUMMARY_KEY]: { ...current, tools } }
}
