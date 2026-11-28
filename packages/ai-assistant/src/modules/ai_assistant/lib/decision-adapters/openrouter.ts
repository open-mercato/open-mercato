import { z } from 'zod'
import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import type {
  DecisionErrorCode,
  DecisionModelAdapter,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
} from '@open-mercato/shared/lib/ai/decision-model'
import { DecisionModelError, normalizeDecisionAnswers, type RawDecisionAnswer } from '../decision-model-schemas'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api'
const API_KEY_ENV = 'OPENROUTER_API_KEY'
const BASE_URL_ENV = 'OM_DECISION_OPENROUTER_BASE_URL'
const VENDOR_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

const wireConfidenceSchema = z.number().nullish()

const wireChoiceAnswerSchema = z.object({
  choice: z.string(),
  confidence: wireConfidenceSchema,
  probabilities: z.record(z.string(), z.number()),
})

const wireScoreAnswerSchema = z.object({
  confidence: wireConfidenceSchema,
  probabilities: z.union([z.array(z.number()), z.record(z.string(), z.number())]),
})

const wireNoulAnswerSchema = z.object({
  noul: z.number(),
})

const wireResponseSchema = z.object({
  model: z.string().nullish(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.record(z.string(), z.unknown()).nullish(),
})

function readEnv(env: EnvLookup | undefined, key: string): string | undefined {
  const value = (env ?? process.env)[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveBaseUrl(env: EnvLookup | undefined): string {
  const configured = readEnv(env, BASE_URL_ENV) ?? DEFAULT_BASE_URL
  return configured.replace(/\/+$/, '')
}

function serializeOrderedObject(entries: Array<[string, string]>): string {
  return `{${entries.map(([key, serializedValue]) => `${JSON.stringify(key)}:${serializedValue}`).join(',')}}`
}

function serializeCriteria(question: DecisionQuestion): string {
  switch (question.type) {
    case 'choice':
      return serializeOrderedObject(question.options.map((option) => [option.key, JSON.stringify(option.criteria)]))
    case 'score':
      return JSON.stringify(question.levels)
    case 'binary':
      return JSON.stringify({ true: question.criteria.true, false: question.criteria.false })
  }
}

function wireQuestionType(question: DecisionQuestion): string {
  return question.type === 'binary' ? 'noul' : question.type
}

function serializeQuestion(question: DecisionQuestion): string {
  return serializeOrderedObject([
    ['type', JSON.stringify(wireQuestionType(question))],
    ['instructions', JSON.stringify(question.instructions)],
    ['criteria', serializeCriteria(question)],
  ])
}

function serializeRequestBody(request: DecisionRequest, modelId: string): string {
  const entries: Array<[string, string]> = [
    ['model', JSON.stringify(modelId)],
    ['state', JSON.stringify(request.state) ?? 'null'],
    ['questions', serializeOrderedObject(
      Object.entries(request.questions).map(([questionName, question]) => [questionName, serializeQuestion(question)]),
    )],
  ]
  if (request.sessionId !== undefined) {
    entries.push(['session_id', JSON.stringify(request.sessionId)])
  }
  return serializeOrderedObject(entries)
}

function mapHttpStatus(status: number): DecisionErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'invalid_request'
    case 401:
    case 403:
      return 'auth'
    case 402:
      return 'insufficient_credits'
    case 404:
      return 'unavailable'
    case 413:
      return 'payload_too_large'
    case 429:
      return 'rate_limited'
    case 524:
      return 'timeout'
    default:
      return 'provider_error'
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractVendorErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  const asString = typeof code === 'number' ? String(code) : code
  return typeof asString === 'string' && VENDOR_ERROR_CODE_PATTERN.test(asString) ? asString : undefined
}

async function readErrorBodySafely(response: Response): Promise<unknown> {
  try {
    return parseJson(await response.text())
  } catch {
    return undefined
  }
}

async function throwHttpError(response: Response): Promise<never> {
  const vendorCode = extractVendorErrorCode(await readErrorBodySafely(response))
  const suffix = vendorCode ? ` (vendor code ${vendorCode})` : ''
  throw new DecisionModelError(
    mapHttpStatus(response.status),
    `OpenRouter decision request failed with HTTP ${response.status}${suffix}`,
    response.status,
  )
}

function unmappableAnswer(questionName: string): DecisionModelError {
  return new DecisionModelError('invalid_response', `OpenRouter answer "${questionName}" has an unexpected shape`)
}

function mapChoiceAnswer(
  questionName: string,
  question: Extract<DecisionQuestion, { type: 'choice' }>,
  wireAnswer: unknown,
): RawDecisionAnswer {
  const parsed = wireChoiceAnswerSchema.safeParse(wireAnswer)
  if (!parsed.success) throw unmappableAnswer(questionName)
  const wireProbabilities = new Map(Object.entries(parsed.data.probabilities))
  const requestKeys = question.options.map((option) => option.key)
  const requestKeySet = new Set(requestKeys)
  const orderedKeys = [
    ...requestKeys.filter((key) => wireProbabilities.has(key)),
    ...[...wireProbabilities.keys()].filter((key) => !requestKeySet.has(key)),
  ]
  return {
    type: 'choice',
    value: parsed.data.choice,
    probabilities: orderedKeys.map((key) => ({ key, probability: wireProbabilities.get(key) ?? 0 })),
    confidence: parsed.data.confidence ?? null,
  }
}

function mapScoreAnswer(questionName: string, wireAnswer: unknown): RawDecisionAnswer {
  const parsed = wireScoreAnswerSchema.safeParse(wireAnswer)
  if (!parsed.success) throw unmappableAnswer(questionName)
  const wireProbabilities = parsed.data.probabilities
  const probabilities = Array.isArray(wireProbabilities)
    ? wireProbabilities.map((probability, level) => ({ level, probability }))
    : Object.entries(wireProbabilities).map(([levelKey, probability]) => {
      if (!/^\d+$/.test(levelKey)) throw unmappableAnswer(questionName)
      return { level: Number(levelKey), probability }
    })
  return { type: 'score', probabilities, confidence: parsed.data.confidence ?? null }
}

function mapBinaryAnswer(questionName: string, wireAnswer: unknown): RawDecisionAnswer {
  const parsed = wireNoulAnswerSchema.safeParse(wireAnswer)
  if (!parsed.success) throw unmappableAnswer(questionName)
  return { type: 'binary', probability: parsed.data.noul }
}

function mapWireAnswers(request: DecisionRequest, wireAnswers: Record<string, unknown>): Record<string, RawDecisionAnswer> {
  const raw: Record<string, RawDecisionAnswer> = {}
  for (const [questionName, question] of Object.entries(request.questions)) {
    if (!Object.prototype.hasOwnProperty.call(wireAnswers, questionName)) continue
    const wireAnswer = wireAnswers[questionName]
    switch (question.type) {
      case 'choice':
        raw[questionName] = mapChoiceAnswer(questionName, question, wireAnswer)
        break
      case 'score':
        raw[questionName] = mapScoreAnswer(questionName, wireAnswer)
        break
      case 'binary':
        raw[questionName] = mapBinaryAnswer(questionName, wireAnswer)
        break
    }
  }
  return raw
}

function readUsageNumber(usage: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = usage?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Decision model adapter for the OpenRouter Decisions API
 * (`POST /api/alpha/decisions`). Maps the neutral port to the vendor wire
 * shape and back; validation of the answers is delegated to
 * `normalizeDecisionAnswers`.
 */
export function createOpenRouterDecisionAdapter(): DecisionModelAdapter {
  return {
    id: 'openrouter',
    isConfigured: (env?: EnvLookup) => readEnv(env, API_KEY_ENV) !== undefined,
    async decide(request: DecisionRequest, options): Promise<DecisionResult> {
      const apiKey = readEnv(options.env, API_KEY_ENV)
      if (!apiKey) {
        throw new DecisionModelError('unavailable', 'OpenRouter decision adapter is not configured')
      }
      const startedAt = Date.now()
      const response = await fetch(`${resolveBaseUrl(options.env)}/alpha/decisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: serializeRequestBody(request, options.modelId),
        signal: options.signal,
      })
      if (!response.ok) {
        await throwHttpError(response)
      }
      const parsed = wireResponseSchema.safeParse(parseJson(await response.text()))
      if (!parsed.success) {
        throw new DecisionModelError('provider_error', 'OpenRouter decision response body is not valid JSON of the expected shape')
      }
      const answers = normalizeDecisionAnswers(request, mapWireAnswers(request, parsed.data.answers))
      return {
        answers,
        provider: 'openrouter',
        model: parsed.data.model ?? options.modelId,
        usage: {
          inputTokens: readUsageNumber(parsed.data.usage, 'input_tokens'),
          outputTokens: readUsageNumber(parsed.data.usage, 'output_tokens'),
          costUsd: readUsageNumber(parsed.data.usage, 'cost'),
        },
        durationMs: Date.now() - startedAt,
      }
    },
  }
}
