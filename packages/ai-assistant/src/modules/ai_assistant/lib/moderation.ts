/**
 * Input pre-moderation service.
 *
 * Wraps OpenAI's free `/v1/moderations` endpoint so the agent runtime can
 * screen the current user turn BEFORE the model call on surfaces that opt in
 * (or are forced on via `untrustedInput`). The service is intentionally pure:
 * it performs the HTTP check and returns category flags + scores, or throws
 * {@link AiModerationUnavailableError} when the endpoint is unreachable. It does
 * NOT persist audit records, emit events, or throw the user-facing block — the
 * runtime gate orchestrates those (see `agent-runtime.ts`).
 *
 * @see .ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md
 */

import { z } from 'zod'

/** Default moderation model; override with `OM_AI_MODERATION_MODEL`. */
export const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const REQUEST_TIMEOUT_MS = 3000

/** Per-category moderation outcome: whether it tripped and the model's score. */
export interface ModerationCategoryResult {
  flagged: boolean
  score: number
}

/** Result of an input moderation check — flags + scores only, never content. */
export interface ModerationResult {
  flagged: boolean
  categories: Record<string, ModerationCategoryResult>
}

/** Arguments for {@link ModerationService.checkInput}. */
export interface ModerationCheckInput {
  /** The current user turn text to screen. */
  text: string
  /** Resolved OpenAI(-compatible) API key for the moderations endpoint. */
  apiKey: string
  /** Optional base URL override (defaults to the OpenAI public endpoint). */
  baseURL?: string
  /** Optional model override (defaults to {@link DEFAULT_MODERATION_MODEL}). */
  model?: string
}

/** Port resolved from the DI container by the agent runtime. */
export interface ModerationService {
  checkInput(input: ModerationCheckInput): Promise<ModerationResult>
}

/**
 * Thrown by the runtime gate (NOT the service) when flagged input is rejected
 * on an enabled/enforced surface. The SSE error path maps it to the
 * `moderation_blocked` code; the raw categories are never sent to the client.
 */
export class AiModerationBlockedError extends Error {
  readonly categories: Record<string, ModerationCategoryResult>

  constructor(categories: Record<string, ModerationCategoryResult>) {
    super('[internal] Input rejected by the content safety filter')
    this.name = 'AiModerationBlockedError'
    this.categories = categories
  }
}

/**
 * Thrown by {@link ModerationService.checkInput} when the moderation endpoint
 * is unreachable (timeout, network error, or non-2xx after one retry). The gate
 * decides fail-closed (enforced surfaces) vs fail-open (opt-in surfaces).
 */
export class AiModerationUnavailableError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(`[internal] ${message}`)
    this.name = 'AiModerationUnavailableError'
    this.cause = cause
  }
}

const moderationResponseSchema = z.object({
  results: z
    .array(
      z.object({
        flagged: z.boolean(),
        categories: z.record(z.string(), z.boolean()),
        category_scores: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
})

function mergeCategories(
  categories: Record<string, boolean>,
  scores: Record<string, number>,
): Record<string, ModerationCategoryResult> {
  const merged: Record<string, ModerationCategoryResult> = {}
  for (const [name, flagged] of Object.entries(categories)) {
    merged[name] = { flagged, score: scores[name] ?? 0 }
  }
  return merged
}

async function postModeration(input: ModerationCheckInput): Promise<Response> {
  const baseURL = (input.baseURL ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${baseURL}/moderations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODERATION_MODEL,
        input: input.text,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Builds the default {@link ModerationService}. Stateless and DI-friendly —
 * registered in `di.ts` and overridable by downstream apps.
 */
export function createModerationService(): ModerationService {
  return {
    async checkInput(input: ModerationCheckInput): Promise<ModerationResult> {
      let lastError: unknown
      // One short-timeout attempt + one retry (R: outage mitigation).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: Response
        try {
          response = await postModeration(input)
        } catch (error) {
          lastError = error
          continue
        }
        if (response.status >= 500) {
          lastError = new Error(`moderation endpoint returned ${response.status}`)
          continue
        }
        if (!response.ok) {
          // 4xx is a configuration/credential error — not transient; do not retry.
          throw new AiModerationUnavailableError(
            `moderation endpoint returned ${response.status}`,
          )
        }
        let json: unknown
        try {
          json = await response.json()
        } catch (error) {
          throw new AiModerationUnavailableError('moderation response was not valid JSON', error)
        }
        const parsed = moderationResponseSchema.safeParse(json)
        if (!parsed.success) {
          throw new AiModerationUnavailableError(
            'moderation response did not match the expected schema',
            parsed.error,
          )
        }
        const result = parsed.data.results[0]
        return {
          flagged: result.flagged,
          categories: mergeCategories(result.categories, result.category_scores),
        }
      }
      throw new AiModerationUnavailableError(
        'moderation endpoint unreachable after retry',
        lastError,
      )
    },
  }
}
