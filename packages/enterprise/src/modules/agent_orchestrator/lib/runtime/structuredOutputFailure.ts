/**
 * The AI SDK's structured-output failures, recognised structurally (by `name`)
 * so this module imports no AI SDK and survives the admission-queue crossing,
 * the same way `agentRunHttp` recognises provider refusals.
 *
 *  - `AI_NoObjectGeneratedError`: the model answered, but its answer is not JSON
 *    or does not match the schema the model was given. The answer text rides on
 *    the error.
 *  - `AI_NoOutputGeneratedError`: the tool loop ended without a final answer
 *    (for example the step budget ran out while the model was still calling
 *    tools). There is no text to recover.
 *
 * Neither is a crash: the run happened and produced an unusable answer. The
 * native runner hands what was recovered to the normal output checks, so the
 * failure is judged by the agent's AUTHORED schema and recorded as a schema
 * guardrail check, exactly like an answer that parsed but failed validation.
 */

import { readCachedInputTokens } from './nativeTraceCapture'

export type StructuredOutputFailure = {
  reason: 'no_object' | 'no_output'
  recovered: unknown
  /** `cachedInputTokens` is the cached SUBSET of `inputTokens`; absent when the provider did not report it. */
  usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | null
}

const NO_OBJECT_ERROR = 'AI_NoObjectGeneratedError'
const NO_OUTPUT_ERROR = 'AI_NoOutputGeneratedError'
const JSON_FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n```/

type ErrorLike = { name?: unknown; text?: unknown; usage?: unknown; cause?: unknown }

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === 'object' ? (value as ErrorLike) : null
}

function findFailure(err: unknown): ErrorLike | null {
  const direct = asErrorLike(err)
  if (!direct) return null
  if (direct.name === NO_OBJECT_ERROR || direct.name === NO_OUTPUT_ERROR) return direct
  const cause = asErrorLike(direct.cause)
  if (cause && (cause.name === NO_OBJECT_ERROR || cause.name === NO_OUTPUT_ERROR)) return cause
  return null
}

/** Parse the model's raw answer text; `undefined` when it holds no JSON value. */
export function parseModelAnswerText(text: unknown): unknown {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const candidates = [trimmed]
  const fenced = JSON_FENCE_RE.exec(trimmed)
  if (fenced) candidates.push(fenced[1].trim())
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      continue
    }
  }
  return undefined
}

function readUsage(usage: unknown): StructuredOutputFailure['usage'] {
  const record = asErrorLike(usage) as { inputTokens?: unknown; outputTokens?: unknown } | null
  if (!record) return null
  const inputTokens = typeof record.inputTokens === 'number' ? record.inputTokens : undefined
  const outputTokens = typeof record.outputTokens === 'number' ? record.outputTokens : undefined
  if (inputTokens === undefined && outputTokens === undefined) return null
  const cachedInputTokens = readCachedInputTokens(usage)
  return { inputTokens, outputTokens, ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}) }
}

export function readStructuredOutputFailure(err: unknown): StructuredOutputFailure | null {
  const failure = findFailure(err)
  if (!failure) return null
  if (failure.name === NO_OUTPUT_ERROR) return { reason: 'no_output', recovered: undefined, usage: null }
  return { reason: 'no_object', recovered: parseModelAnswerText(failure.text), usage: readUsage(failure.usage) }
}

export function describeStructuredOutputFailure(failure: StructuredOutputFailure): string {
  return failure.reason === 'no_output'
    ? 'the model ended without a final structured answer'
    : 'the model answer did not match the structured-output schema'
}
