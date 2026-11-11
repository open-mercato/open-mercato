import type { DecisionQuestion, DecisionRequest } from '@open-mercato/shared/lib/ai/decision-model'
import { createFixtureDecisionAdapter } from '../decision-adapters/fixture'

function choiceQuestion(keys: string[]): DecisionQuestion {
  return {
    type: 'choice',
    instructions: 'Pick the queue',
    options: keys.map((key) => ({ key, criteria: `Queue ${key}` })),
  }
}

async function decide(request: DecisionRequest) {
  const adapter = createFixtureDecisionAdapter()
  return adapter.decide(request, { modelId: 'fixture-model', signal: new AbortController().signal })
}

async function decideChoice(state: unknown, keys: string[]) {
  const result = await decide({ state, questions: { route: choiceQuestion(keys) } })
  const answer = result.answers.route
  if (answer.type !== 'choice') throw new Error('[internal] expected a choice answer')
  return answer
}

describe('createFixtureDecisionAdapter', () => {
  it('exposes the fixture id and is always configured', () => {
    const adapter = createFixtureDecisionAdapter()
    expect(adapter.id).toBe('fixture')
    expect(adapter.isConfigured()).toBe(true)
    expect(adapter.isConfigured({})).toBe(true)
  })

  it('picks an option whose key appears as a whole word, case-insensitively', async () => {
    const answer = await decideChoice({ ticket: 'Please send a REFUND now' }, ['billing', 'refund'])
    expect(answer.value).toBe('refund')
    expect(answer.probabilities).toEqual([
      { key: 'billing', probability: 0 },
      { key: 'refund', probability: 1 },
    ])
    expect(answer.confidence).toBe(1)
  })

  it('does not match a key that only appears as a substring', async () => {
    const answer = await decideChoice({ ticket: 'billing question' }, ['bill', 'other'])
    expect(answer.probabilities).toEqual([
      { key: 'bill', probability: 0.5 },
      { key: 'other', probability: 0.5 },
    ])
  })

  it('lets the first matching option in option order win', async () => {
    const answer = await decideChoice({ ticket: 'refund for billing' }, ['billing', 'refund', 'other'])
    expect(answer.value).toBe('billing')
    expect(answer.probabilities.map((entry) => entry.probability)).toEqual([1, 0, 0])
  })

  it('returns a uniform distribution with the first option when nothing matches', async () => {
    const answer = await decideChoice({ ticket: 'hello' }, ['alpha', 'beta', 'gamma', 'delta'])
    expect(answer.value).toBe('alpha')
    expect(answer.probabilities.map((entry) => entry.probability)).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(answer.confidence).toBe(0.25)
  })

  it('treats an undefined state as empty', async () => {
    const answer = await decideChoice(undefined, ['alpha', 'beta'])
    expect(answer.value).toBe('alpha')
    expect(answer.confidence).toBe(0.5)
  })

  it('matches keys containing hyphens and underscores as whole words', async () => {
    const hyphen = await decideChoice({ queue: 'route to tier-2 now' }, ['tier', 'tier-2'])
    expect(hyphen.value).toBe('tier-2')
    const underscore = await decideChoice({ queue: 'escalate_now' }, ['escalate', 'escalate_now'])
    expect(underscore.value).toBe('escalate_now')
    const partial = await decideChoice({ queue: 'tier-22' }, ['tier-2', 'other'])
    expect(partial.confidence).toBe(0.5)
  })

  it('answers score questions with a uniform distribution and derived value and level', async () => {
    const result = await decide({
      state: { text: 'anything' },
      questions: { urgency: { type: 'score', instructions: 'Rate urgency', levels: ['low', 'medium', 'high'] } },
    })
    const answer = result.answers.urgency
    if (answer.type !== 'score') throw new Error('[internal] expected a score answer')
    expect(answer.value).toBeCloseTo(1)
    expect(answer.level).toBe(0)
    expect(answer.probabilities.map((entry) => entry.probability)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(answer.confidence).toBeCloseTo(1 / 3)
  })

  it('answers binary questions with probability 0.5', async () => {
    const result = await decide({
      state: {},
      questions: { spam: { type: 'binary', instructions: 'Is it spam?', criteria: { true: 'spam', false: 'not spam' } } },
    })
    expect(result.answers.spam).toEqual({ type: 'binary', probability: 0.5 })
  })

  it('reports fixture provider metadata and null usage', async () => {
    const result = await decide({ state: {}, questions: { route: choiceQuestion(['alpha', 'beta']) } })
    expect(result.provider).toBe('fixture')
    expect(result.model).toBe('fixture-model')
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, costUsd: null })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rethrows the abort reason when the signal is already aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('[internal] cancelled')
    controller.abort(reason)
    const adapter = createFixtureDecisionAdapter()
    await expect(
      adapter.decide(
        { state: {}, questions: { route: choiceQuestion(['alpha', 'beta']) } },
        { modelId: 'fixture-model', signal: controller.signal },
      ),
    ).rejects.toBe(reason)
  })
})
