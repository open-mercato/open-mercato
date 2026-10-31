import type {
  DecisionErrorCode,
  DecisionRequest,
  DecisionResult,
} from '@open-mercato/shared/lib/ai/decision-model'
import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import { countTokens } from '@open-mercato/shared/lib/ai/token-count'
import { createLogger, type Logger } from '@open-mercato/shared/lib/logger'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  createDecisionModelRegistry,
  type DecisionModelRegistry,
  type DecisionModelUnavailableReason,
} from './decision-model-registry'
import { DecisionModelError, decisionRequestSchema, normalizeDecisionAnswers } from './decision-model-schemas'

export const DEFAULT_DECISION_TIMEOUT_MS = 5000
export const MAX_DECISION_TIMEOUT_MS = 30000
export const DEFAULT_DECISION_MAX_INPUT_TOKENS = 24000

const MAX_INPUT_TOKENS_ENV = 'OM_DECISION_MAX_INPUT_TOKENS'

/** @experimental Availability of the decision model for an optional module. */
export interface DecisionModelAvailability {
  available: boolean
  provider?: string
  model?: string
  reason?: DecisionModelUnavailableReason
}

/** @experimental Closed error shape returned by `decide`. */
export interface DecisionModelDecideError {
  code: DecisionErrorCode
  message: string
  httpStatus?: number
}

/** @experimental Discriminated result of `decide`; it never throws. */
export type DecisionModelDecideResult =
  | { ok: true; result: DecisionResult }
  | { ok: false; error: DecisionModelDecideError }

/** @experimental Input of `decide`. */
export interface DecisionModelDecideInput {
  request: DecisionRequest
  moduleId?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** @experimental DI service `decisionModelService`. */
export interface DecisionModelService {
  getAvailability(input?: { moduleId?: string }): DecisionModelAvailability
  decide(input: DecisionModelDecideInput): Promise<DecisionModelDecideResult>
}

/** Minimal logger shape the service writes through. */
export type DecisionModelServiceLogger = Pick<Logger, 'info' | 'warn'>

/** Error reporter the service calls on `provider_error` / `invalid_response`. */
export type DecisionModelReportError = (
  error: unknown,
  context: { module: string; code: string },
) => void

/** Optional dependencies of `createDecisionModelService`, mainly for tests and overrides. */
export interface DecisionModelServiceDeps {
  registry?: DecisionModelRegistry
  env?: EnvLookup
  logger?: DecisionModelServiceLogger
  reportError?: DecisionModelReportError
  now?: () => number
}

const ERROR_MESSAGES: Record<DecisionErrorCode, string> = {
  unavailable: 'Decision model is unavailable',
  invalid_request: 'Decision request is invalid',
  auth: 'Decision provider rejected the credentials',
  insufficient_credits: 'Decision provider credits are exhausted',
  rate_limited: 'Decision provider rate limit reached',
  payload_too_large: 'Decision request is too large',
  timeout: 'Decision request timed out',
  aborted: 'Decision request was aborted',
  provider_error: 'Decision provider failed',
  invalid_response: 'Decision provider returned an invalid response',
}

const REPORTED_ERROR_CODES: Partial<Record<DecisionErrorCode, string>> = {
  provider_error: 'ai_assistant.decision_provider_error',
  invalid_response: 'ai_assistant.decision_invalid_response',
}

function messageFor(code: DecisionErrorCode): string {
  return ERROR_MESSAGES[code] ?? 'Decision request failed'
}

/** Clamps a caller timeout to the port bounds: default 5 s, maximum 30 s. */
export function resolveDecisionTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_DECISION_TIMEOUT_MS
  }
  return Math.min(timeoutMs, MAX_DECISION_TIMEOUT_MS)
}

function resolveMaxInputTokens(env: EnvLookup): number {
  const raw = env[MAX_INPUT_TOKENS_ENV]
  return parseNumberWithDefault(typeof raw === 'string' ? raw : undefined, DEFAULT_DECISION_MAX_INPUT_TOKENS, {
    min: 1,
    integer: true,
  })
}

function defaultReportError(error: unknown, context: { module: string; code: string }): void {
  getTelemetryRuntime()?.reportError(error, context)
}

function abortPromise(signal: AbortSignal): { promise: Promise<never>; cleanup: () => void } {
  let listener: (() => void) | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    listener = () => reject(signal.reason)
    signal.addEventListener('abort', listener, { once: true })
  })
  return {
    promise,
    cleanup: () => {
      if (listener) signal.removeEventListener('abort', listener)
    },
  }
}

class DecisionFailure extends Error {
  readonly failure: DecisionModelDecideError
  readonly origin: unknown

  constructor(failure: DecisionModelDecideError, origin?: unknown) {
    super(`[internal] ${failure.message}`)
    this.name = 'DecisionFailure'
    this.failure = failure
    this.origin = origin
  }
}

function fail(code: DecisionErrorCode, message?: string, httpStatus?: number, origin?: unknown): DecisionFailure {
  const failure: DecisionModelDecideError = { code, message: message ?? messageFor(code) }
  if (httpStatus !== undefined) failure.httpStatus = httpStatus
  return new DecisionFailure(failure, origin)
}

/**
 * Creates the decision model service. `decide` never throws or rejects: every
 * failure becomes `{ ok: false, error }`. The request state, instructions,
 * criteria and session id are never logged.
 *
 * @experimental
 */
export function createDecisionModelService(deps: DecisionModelServiceDeps = {}): DecisionModelService {
  let registry: DecisionModelRegistry | undefined = deps.registry
  let logger: DecisionModelServiceLogger | undefined = deps.logger
  const env: EnvLookup = deps.env ?? process.env
  const reportError: DecisionModelReportError = deps.reportError ?? defaultReportError
  const now = deps.now ?? (() => Date.now())

  const getRegistry = (): DecisionModelRegistry => {
    if (!registry) registry = createDecisionModelRegistry({ env })
    return registry
  }

  const getLogger = (): DecisionModelServiceLogger => {
    if (!logger) logger = createLogger('ai_assistant').child({ component: 'decision-model' })
    return logger
  }

  const safeLog = (level: 'info' | 'warn', fields: Record<string, unknown>): void => {
    try {
      getLogger()[level]('decision model call', fields)
    } catch {
      return
    }
  }

  const safeReport = (code: DecisionErrorCode, error: unknown): void => {
    const reportCode = REPORTED_ERROR_CODES[code]
    if (!reportCode) return
    try {
      reportError(error, { module: 'ai_assistant', code: reportCode })
    } catch {
      return
    }
  }

  const getAvailability: DecisionModelService['getAvailability'] = (input) => {
    try {
      const resolution = getRegistry().resolve({ moduleId: input?.moduleId, env })
      if (!resolution.ok) return { available: false, reason: resolution.reason }
      return { available: true, provider: resolution.adapter.id, model: resolution.modelId }
    } catch {
      return { available: false, reason: 'not_configured' }
    }
  }

  const decide: DecisionModelService['decide'] = async (input) => {
    const startedAt = now()
    let provider: string | undefined
    let model: string | undefined
    let questionCount = 0
    try {
      const parsed = decisionRequestSchema.safeParse(input?.request)
      if (!parsed.success) throw fail('invalid_request')
      const request: DecisionRequest = parsed.data
      questionCount = Object.keys(request.questions).length

      let serialized: string | undefined
      try {
        serialized = JSON.stringify({ state: request.state, questions: request.questions })
      } catch {
        throw fail('invalid_request', 'Decision request state cannot be serialized')
      }
      if (countTokens(serialized ?? '') > resolveMaxInputTokens(env)) throw fail('payload_too_large')

      const resolution = getRegistry().resolve({ moduleId: input.moduleId, env })
      if (!resolution.ok) {
        throw fail('unavailable', `Decision model unavailable: ${resolution.reason}`)
      }
      provider = resolution.adapter.id
      model = resolution.modelId

      const callerSignal = input.signal
      if (callerSignal?.aborted) throw fail('aborted')

      const timeoutMs = resolveDecisionTimeoutMs(input.timeoutMs)
      const timeoutController = new AbortController()
      const timeoutReason = new DecisionModelError('timeout', `Decision request exceeded ${timeoutMs} ms`)
      const timer = setTimeout(() => timeoutController.abort(timeoutReason), timeoutMs)
      const combined = AbortSignal.any([timeoutController.signal, ...(callerSignal ? [callerSignal] : [])])
      const abort = abortPromise(combined)

      let result: DecisionResult
      try {
        result = await Promise.race([
          resolution.adapter.decide(request, { modelId: resolution.modelId, env, signal: combined }),
          abort.promise,
        ])
      } catch (error) {
        if (combined.aborted) {
          const abortCode: DecisionErrorCode = combined.reason === timeoutReason ? 'timeout' : 'aborted'
          throw fail(abortCode, undefined, undefined, error)
        }
        if (error instanceof DecisionModelError) {
          throw fail(error.code, undefined, error.httpStatus, error)
        }
        throw fail('provider_error', undefined, undefined, error)
      } finally {
        clearTimeout(timer)
        abort.cleanup()
      }

      let answers: DecisionResult['answers']
      try {
        answers = normalizeDecisionAnswers(request, result.answers)
      } catch (error) {
        throw fail('invalid_response', undefined, undefined, error)
      }

      const durationMs = now() - startedAt
      const finalResult: DecisionResult = { ...result, answers, durationMs }
      safeLog('info', {
        provider: finalResult.provider,
        model: finalResult.model,
        durationMs,
        usage: finalResult.usage,
        questionCount,
        outcomeCodes: ['ok'],
      })
      return { ok: true, result: finalResult }
    } catch (error) {
      const failure = error instanceof DecisionFailure ? error.failure : fail('provider_error').failure
      const cause = error instanceof DecisionFailure ? error.origin ?? error : error
      safeLog('warn', {
        provider: provider ?? null,
        model: model ?? null,
        durationMs: now() - startedAt,
        usage: null,
        questionCount,
        outcomeCodes: [failure.code],
      })
      safeReport(failure.code, cause)
      return { ok: false, error: failure }
    }
  }

  return { getAvailability, decide }
}
