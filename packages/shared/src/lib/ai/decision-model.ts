/**
 * Decision model port — the contract for models that take application state
 * plus typed questions and return a typed answer with a probability
 * distribution (e.g. TypeSafe Jev through the OpenRouter Decisions API).
 *
 * Types only, mirroring `llm-provider.ts`. The zod schemas, registry,
 * adapters and the `decisionModelService` DI service live in
 * `@open-mercato/ai-assistant`. Consumers import these types and resolve the
 * service soft-optionally from DI.
 *
 * @experimental for one minor release. `DecisionAnswer['type']` and
 * `DecisionErrorCode` are open unions: consumers MUST keep a default branch.
 *
 * @see .ai/specs/2026-10-06-ai-decision-model-port.md
 */

import type { EnvLookup } from './llm-provider'

/**
 * One named question. Options and levels are ordered arrays because current
 * models are order-sensitive; adapters MUST preserve the order.
 *
 * @experimental
 */
export type DecisionQuestion =
  | { type: 'choice'; instructions: string; options: Array<{ key: string; criteria: string }> }
  | { type: 'score'; instructions: string; levels: string[] }
  | { type: 'binary'; instructions: string; criteria: { true: string; false: string } }

/** @experimental */
export interface DecisionRequest {
  state: unknown
  questions: Record<string, DecisionQuestion>
  /** Opaque, pseudonymous id (e.g. a workflow instance id). Never a user identifier. */
  sessionId?: string
}

/**
 * The answer to one question. `probabilities` follow the request's option or
 * level order exactly. For `score`, `value` is the probability-weighted
 * position in `[0, levels.length - 1]` and `level` the argmax index. For
 * `binary`, `probability` is P(true).
 *
 * @experimental
 */
export type DecisionAnswer =
  | { type: 'choice'; value: string; probabilities: Array<{ key: string; probability: number }>; confidence: number | null }
  | { type: 'score'; value: number; level: number; probabilities: Array<{ level: number; probability: number }>; confidence: number | null }
  | { type: 'binary'; probability: number }

/** @experimental */
export interface DecisionResult {
  answers: Record<string, DecisionAnswer>
  provider: string
  model: string
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null }
  durationMs: number
}

/** @experimental Open union — keep a default branch when switching on it. */
export type DecisionErrorCode =
  | 'unavailable' | 'invalid_request' | 'auth' | 'insufficient_credits' | 'rate_limited'
  | 'payload_too_large' | 'timeout' | 'aborted' | 'provider_error' | 'invalid_response'

/**
 * A decision model adapter. Stateless; selected by `OM_DECISION_PROVIDER`.
 *
 * @experimental
 */
export interface DecisionModelAdapter {
  id: string
  isConfigured(env?: EnvLookup): boolean
  decide(request: DecisionRequest, options: { modelId: string; env?: EnvLookup; signal: AbortSignal }): Promise<DecisionResult>
}
