import {
  aiAgentCallSettingsSchema,
  mergeCallSettings,
  type AiAgentCallSettings,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'

export const EVAL_RUN_SUMMARY_KEY = '__evalRun' as const

export type EvalRunSettings = {
  callSettings: AiAgentCallSettings
}

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
