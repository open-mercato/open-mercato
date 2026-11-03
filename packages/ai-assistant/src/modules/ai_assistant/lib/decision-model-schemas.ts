/**
 * Zod schemas and response normalization for the decision model port.
 *
 * The port types live in `@open-mercato/shared/lib/ai/decision-model` (types
 * only); these schemas are their runtime counterpart and stay internal to
 * `ai-assistant`. A type-level test keeps the two from drifting.
 *
 * @see .ai/specs/2026-10-06-ai-decision-model-port.md
 */

import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  DecisionAnswer,
  DecisionErrorCode,
  DecisionQuestion,
  DecisionRequest,
} from '@open-mercato/shared/lib/ai/decision-model'

const decisionKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).refine((key) => key !== '__proto__', {
  message: 'Reserved key',
})

export const decisionChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: z.string().min(1).max(4000),
  options: z.array(z.object({ key: decisionKeySchema, criteria: z.string().min(1).max(500) }))
    .min(2).max(64)
    .refine((options) => new Set(options.map((option) => option.key)).size === options.length, {
      message: 'Option keys must be unique',
    }),
})

export const decisionScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: z.string().min(1).max(4000),
  levels: z.array(z.string().min(1).max(500)).min(2).max(16),
})

export const decisionBinaryQuestionSchema = z.object({
  type: z.literal('binary'),
  instructions: z.string().min(1).max(4000),
  criteria: z.object({ true: z.string().min(1).max(500), false: z.string().min(1).max(500) }),
})

export const decisionQuestionSchema = z.discriminatedUnion('type', [
  decisionChoiceQuestionSchema,
  decisionScoreQuestionSchema,
  decisionBinaryQuestionSchema,
])

export const decisionRequestSchema = z.object({
  state: z.unknown(),
  questions: z.unknown()
    .refine((raw) => !(typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, '__proto__')), {
      message: 'Reserved question name',
    })
    .pipe(z.record(decisionKeySchema, decisionQuestionSchema))
    .refine((questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 8, {
      message: 'Between 1 and 8 questions are required',
    }),
  sessionId: z.string().max(256).optional(),
})

/**
 * Error thrown by adapters and internal helpers. The service catches it and
 * turns it into the closed `{ ok: false, error }` result; it never reaches
 * consumers.
 */
export class DecisionModelError extends Error {
  readonly code: DecisionErrorCode
  readonly httpStatus?: number

  constructor(code: DecisionErrorCode, message: string, httpStatus?: number) {
    super(`[internal] ${message}`)
    this.name = 'DecisionModelError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export const PROBABILITY_SUM_TOLERANCE = 0.02

const EXACT_SUM_EPSILON = 1e-9

const logger = createLogger('ai_assistant').child({ component: 'decision-model' })

function logNormalized(questionName: string, sum: number): void {
  try {
    logger.debug('Normalized decision probabilities', { questionName, sum })
  } catch {
    return
  }
}

const probabilitySchema = z.number().finite().min(0).max(1)

const rawChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  value: z.string(),
  probabilities: z.array(z.object({ key: z.string(), probability: probabilitySchema })),
  confidence: probabilitySchema.nullable(),
})

const rawScoreAnswerSchema = z.object({
  type: z.literal('score'),
  probabilities: z.array(z.object({ level: z.number().int(), probability: probabilitySchema })),
  confidence: probabilitySchema.nullable(),
})

const rawBinaryAnswerSchema = z.object({
  type: z.literal('binary'),
  probability: probabilitySchema,
})

/**
 * What an adapter hands back per question before the port validates it. For
 * `score`, the port derives `value` and `level` itself, so adapters only
 * supply the distribution.
 */
export const rawDecisionAnswerSchema = z.discriminatedUnion('type', [
  rawChoiceAnswerSchema,
  rawScoreAnswerSchema,
  rawBinaryAnswerSchema,
])

export type RawDecisionAnswer = z.infer<typeof rawDecisionAnswerSchema>

function invalidResponse(questionName: string, reason: string): DecisionModelError {
  return new DecisionModelError('invalid_response', `Decision answer "${questionName}" ${reason}`)
}

function normalizeDistribution(questionName: string, probabilities: number[]): number[] {
  const sum = probabilities.reduce((total, probability) => total + probability, 0)
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    throw invalidResponse(questionName, 'has probabilities that do not sum to 1')
  }
  if (Math.abs(sum - 1) > EXACT_SUM_EPSILON) logNormalized(questionName, sum)
  return probabilities.map((probability) => probability / sum)
}

function argmax(values: number[]): number {
  return values.reduce((bestIndex, value, index) => (value > values[bestIndex] ? index : bestIndex), 0)
}

function normalizeChoice(
  questionName: string,
  question: Extract<DecisionQuestion, { type: 'choice' }>,
  answer: z.infer<typeof rawChoiceAnswerSchema>,
): DecisionAnswer {
  const byKey = new Map(answer.probabilities.map((entry) => [entry.key, entry.probability]))
  const requestKeys = question.options.map((option) => option.key)
  if (byKey.size !== answer.probabilities.length || byKey.size !== requestKeys.length || requestKeys.some((key) => !byKey.has(key))) {
    throw invalidResponse(questionName, 'does not cover exactly the requested options')
  }
  if (!byKey.has(answer.value)) {
    throw invalidResponse(questionName, 'selected an option that was not requested')
  }
  const normalized = normalizeDistribution(questionName, requestKeys.map((key) => byKey.get(key) ?? 0))
  return {
    type: 'choice',
    value: answer.value,
    probabilities: requestKeys.map((key, index) => ({ key, probability: normalized[index] })),
    confidence: answer.confidence,
  }
}

function normalizeScore(
  questionName: string,
  question: Extract<DecisionQuestion, { type: 'score' }>,
  answer: z.infer<typeof rawScoreAnswerSchema>,
): DecisionAnswer {
  const byLevel = new Map(answer.probabilities.map((entry) => [entry.level, entry.probability]))
  const levelCount = question.levels.length
  const levelIndexes = question.levels.map((_, index) => index)
  if (byLevel.size !== answer.probabilities.length || byLevel.size !== levelCount || levelIndexes.some((level) => !byLevel.has(level))) {
    throw invalidResponse(questionName, 'does not cover exactly the requested levels')
  }
  const normalized = normalizeDistribution(questionName, levelIndexes.map((level) => byLevel.get(level) ?? 0))
  const value = normalized.reduce((total, probability, level) => total + probability * level, 0)
  return {
    type: 'score',
    value,
    level: argmax(normalized),
    probabilities: levelIndexes.map((level) => ({ level, probability: normalized[level] })),
    confidence: answer.confidence,
  }
}

/**
 * Validates adapter output against the request and returns port answers:
 * every question answered with a matching type, probabilities in [0, 1],
 * key/level sets equal to the request's, the chosen value among them, and
 * `choice`/`score` distributions summing to 1 ± 0.02 (then normalized to
 * exactly 1). `probabilities` come back in request order. Any violation
 * throws `DecisionModelError('invalid_response')`.
 */
export function normalizeDecisionAnswers(
  request: DecisionRequest,
  rawAnswers: Record<string, unknown>,
): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {}
  for (const [questionName, question] of Object.entries(request.questions)) {
    if (!Object.prototype.hasOwnProperty.call(rawAnswers, questionName)) {
      throw invalidResponse(questionName, 'is missing')
    }
    const parsed = rawDecisionAnswerSchema.safeParse(rawAnswers[questionName])
    if (!parsed.success) {
      throw invalidResponse(questionName, 'has an invalid shape')
    }
    const answer = parsed.data
    if (answer.type !== question.type) {
      throw invalidResponse(questionName, 'has a type that does not match the question')
    }
    if (answer.type === 'choice' && question.type === 'choice') {
      answers[questionName] = normalizeChoice(questionName, question, answer)
    } else if (answer.type === 'score' && question.type === 'score') {
      answers[questionName] = normalizeScore(questionName, question, answer)
    } else if (answer.type === 'binary') {
      answers[questionName] = { type: 'binary', probability: answer.probability }
    }
  }
  return answers
}
