import type {
  DecisionModelAdapter,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
} from '@open-mercato/shared/lib/ai/decision-model'
import { normalizeDecisionAnswers, type RawDecisionAnswer } from '../decision-model-schemas'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholeWord(haystack: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(word)}($|[^A-Za-z0-9_-])`, 'i')
  return pattern.test(haystack)
}

function serializeState(state: unknown): string {
  return JSON.stringify(state) ?? ''
}

function answerChoice(
  question: Extract<DecisionQuestion, { type: 'choice' }>,
  serializedState: string,
): RawDecisionAnswer {
  const matched = question.options.find((option) => containsWholeWord(serializedState, option.key))
  if (matched) {
    return {
      type: 'choice',
      value: matched.key,
      probabilities: question.options.map((option) => ({
        key: option.key,
        probability: option.key === matched.key ? 1 : 0,
      })),
      confidence: 1,
    }
  }
  const uniform = 1 / question.options.length
  return {
    type: 'choice',
    value: question.options[0].key,
    probabilities: question.options.map((option) => ({ key: option.key, probability: uniform })),
    confidence: uniform,
  }
}

function answerScore(question: Extract<DecisionQuestion, { type: 'score' }>): RawDecisionAnswer {
  const uniform = 1 / question.levels.length
  return {
    type: 'score',
    probabilities: question.levels.map((_, level) => ({ level, probability: uniform })),
    confidence: uniform,
  }
}

function answerQuestion(question: DecisionQuestion, serializedState: string): RawDecisionAnswer {
  switch (question.type) {
    case 'choice':
      return answerChoice(question, serializedState)
    case 'score':
      return answerScore(question)
    case 'binary':
      return { type: 'binary', probability: 0.5 }
  }
}

/**
 * Deterministic, vendor-free decision adapter for tests and local
 * development (spec D9). Registration is gated by the registry, not here.
 */
export function createFixtureDecisionAdapter(): DecisionModelAdapter {
  return {
    id: 'fixture',
    isConfigured: () => true,
    async decide(request: DecisionRequest, options): Promise<DecisionResult> {
      if (options.signal.aborted) {
        throw options.signal.reason
      }
      const startedAt = Date.now()
      const serializedState = serializeState(request.state)
      const raw: Record<string, RawDecisionAnswer> = {}
      for (const [questionName, question] of Object.entries(request.questions)) {
        raw[questionName] = answerQuestion(question, serializedState)
      }
      const answers = normalizeDecisionAnswers(request, raw)
      return {
        answers,
        provider: 'fixture',
        model: options.modelId,
        usage: { inputTokens: null, outputTokens: null, costUsd: null },
        durationMs: Date.now() - startedAt,
      }
    },
  }
}
