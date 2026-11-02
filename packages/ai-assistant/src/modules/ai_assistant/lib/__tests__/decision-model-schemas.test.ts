import type { z } from 'zod'
import type { DecisionRequest } from '@open-mercato/shared/lib/ai/decision-model'
import {
  DecisionModelError,
  decisionRequestSchema,
  normalizeDecisionAnswers,
} from '../decision-model-schemas'

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const requestTypesMatch: MutuallyAssignable<z.infer<typeof decisionRequestSchema>, DecisionRequest> = true

function choiceRequest(keys: string[]): DecisionRequest {
  return {
    state: { ticket: 'refund please' },
    questions: {
      route: {
        type: 'choice',
        instructions: 'Pick the queue',
        options: keys.map((key) => ({ key, criteria: `Queue ${key}` })),
      },
    },
  }
}

function expectInvalidResponse(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionModelError)
    expect((error as DecisionModelError).code).toBe('invalid_response')
    return
  }
  throw new Error('expected invalid_response')
}

describe('decisionRequestSchema', () => {
  it('keeps the shared DecisionRequest type in sync with the schema', () => {
    expect(requestTypesMatch).toBe(true)
  })

  it('accepts all three question types', () => {
    const parsed = decisionRequestSchema.safeParse({
      state: { any: ['thing'] },
      questions: {
        route: { type: 'choice', instructions: 'Pick', options: [{ key: 'a', criteria: 'A' }, { key: 'b', criteria: 'B' }] },
        urgency: { type: 'score', instructions: 'Rate', levels: ['low', 'high'] },
        spam: { type: 'binary', instructions: 'Spam?', criteria: { true: 'spam', false: 'not spam' } },
      },
      sessionId: 'workflow-instance-1',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects __proto__ as a question name or option key instead of dropping it', () => {
    const questions = JSON.parse('{"__proto__":{"type":"score","instructions":"Rate","levels":["a","b"]},"other":{"type":"score","instructions":"Rate","levels":["a","b"]}}')
    expect(decisionRequestSchema.safeParse({ state: null, questions }).success).toBe(false)
    expect(decisionRequestSchema.safeParse(choiceRequest(['__proto__', 'b'])).success).toBe(false)
  })

  it('rejects an unknown question type', () => {
    const parsed = decisionRequestSchema.safeParse({
      state: null,
      questions: { route: { type: 'noul', instructions: 'Pick', criteria: { true: 'a', false: 'b' } } },
    })
    expect(parsed.success).toBe(false)
  })

  it('enforces question count, option count, key format and duplicate keys', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`q${index}`, { type: 'score', instructions: 'Rate', levels: ['a', 'b'] }]),
    )
    expect(decisionRequestSchema.safeParse({ state: null, questions: {} }).success).toBe(false)
    expect(decisionRequestSchema.safeParse({ state: null, questions: tooMany }).success).toBe(false)
    expect(decisionRequestSchema.safeParse(choiceRequest(['only'])).success).toBe(false)
    expect(decisionRequestSchema.safeParse(choiceRequest(['bad key', 'ok'])).success).toBe(false)
    expect(decisionRequestSchema.safeParse(choiceRequest(['same', 'same'])).success).toBe(false)
    expect(decisionRequestSchema.safeParse({
      state: null,
      questions: { 'bad name': { type: 'score', instructions: 'Rate', levels: ['a', 'b'] } },
    }).success).toBe(false)
  })

  it('enforces text and sessionId limits', () => {
    const longInstructions = choiceRequest(['a', 'b'])
    const question = longInstructions.questions.route
    if (question.type === 'choice') question.instructions = 'x'.repeat(4001)
    expect(decisionRequestSchema.safeParse(longInstructions).success).toBe(false)
    expect(decisionRequestSchema.safeParse({ ...choiceRequest(['a', 'b']), sessionId: 'x'.repeat(257) }).success).toBe(false)
  })

  it('preserves option order, including integer-like keys', () => {
    const parsed = decisionRequestSchema.parse(choiceRequest(['10', '2', 'b', '1']))
    const question = parsed.questions.route
    expect(question.type === 'choice' && question.options.map((option) => option.key)).toEqual(['10', '2', 'b', '1'])
  })
})

describe('normalizeDecisionAnswers', () => {
  it('returns choice probabilities in request order and normalizes a near-1 sum', () => {
    const answers = normalizeDecisionAnswers(choiceRequest(['10', '2', 'b']), {
      route: {
        type: 'choice',
        value: '2',
        probabilities: [
          { key: 'b', probability: 0.1 },
          { key: '10', probability: 0.2 },
          { key: '2', probability: 0.71 },
        ],
        confidence: 0.71,
      },
    })
    const answer = answers.route
    expect(answer.type).toBe('choice')
    if (answer.type !== 'choice') return
    expect(answer.value).toBe('2')
    expect(answer.probabilities.map((entry) => entry.key)).toEqual(['10', '2', 'b'])
    expect(answer.probabilities.reduce((total, entry) => total + entry.probability, 0)).toBeCloseTo(1, 10)
    expect(answer.probabilities[1].probability).toBeCloseTo(0.71 / 1.01, 10)
  })

  it('rejects a sum outside 1 ± 0.02', () => {
    expectInvalidResponse(() => normalizeDecisionAnswers(choiceRequest(['a', 'b']), {
      route: { type: 'choice', value: 'a', probabilities: [{ key: 'a', probability: 0.5 }, { key: 'b', probability: 0.4 }], confidence: 0.5 },
    }))
  })

  it('rejects a missing key, an extra key, a duplicate key and an unknown selection', () => {
    const request = choiceRequest(['a', 'b'])
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'a', probabilities: [{ key: 'a', probability: 1 }], confidence: 1 },
    }))
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'a', probabilities: [{ key: 'a', probability: 0.5 }, { key: 'b', probability: 0.25 }, { key: 'c', probability: 0.25 }], confidence: 0.5 },
    }))
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'a', probabilities: [{ key: 'a', probability: 0.5 }, { key: 'a', probability: 0.5 }], confidence: 0.5 },
    }))
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'z', probabilities: [{ key: 'a', probability: 0.5 }, { key: 'b', probability: 0.5 }], confidence: 0.5 },
    }))
  })

  it('rejects probabilities outside [0, 1], a missing answer and a type mismatch', () => {
    const request = choiceRequest(['a', 'b'])
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'a', probabilities: [{ key: 'a', probability: 1.5 }, { key: 'b', probability: -0.5 }], confidence: 1 },
    }))
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {}))
    expectInvalidResponse(() => normalizeDecisionAnswers(request, { route: { type: 'binary', probability: 0.5 } }))
  })

  it('derives score value as the weighted position and level as the argmax', () => {
    const request: DecisionRequest = {
      state: null,
      questions: { urgency: { type: 'score', instructions: 'Rate', levels: ['low', 'medium', 'high'] } },
    }
    const answers = normalizeDecisionAnswers(request, {
      urgency: {
        type: 'score',
        probabilities: [
          { level: 2, probability: 0.6 },
          { level: 0, probability: 0.1 },
          { level: 1, probability: 0.3 },
        ],
        confidence: 0.6,
      },
    })
    const answer = answers.urgency
    expect(answer.type).toBe('score')
    if (answer.type !== 'score') return
    expect(answer.level).toBe(2)
    expect(answer.value).toBeCloseTo(0.3 + 1.2, 10)
    expect(answer.probabilities.map((entry) => entry.level)).toEqual([0, 1, 2])
  })

  it('rejects a score distribution that does not match the requested levels', () => {
    const request: DecisionRequest = {
      state: null,
      questions: { urgency: { type: 'score', instructions: 'Rate', levels: ['low', 'high'] } },
    }
    expectInvalidResponse(() => normalizeDecisionAnswers(request, {
      urgency: { type: 'score', probabilities: [{ level: 0, probability: 0.5 }, { level: 2, probability: 0.5 }], confidence: 0.5 },
    }))
  })

  it('passes binary P(true) through', () => {
    const request: DecisionRequest = {
      state: null,
      questions: { spam: { type: 'binary', instructions: 'Spam?', criteria: { true: 'spam', false: 'not spam' } } },
    }
    expect(normalizeDecisionAnswers(request, { spam: { type: 'binary', probability: 0.83 } })).toEqual({
      spam: { type: 'binary', probability: 0.83 },
    })
  })
})
