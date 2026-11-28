import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import type { DecisionRequest } from '@open-mercato/shared/lib/ai/decision-model'
import { createOpenRouterDecisionAdapter } from '../decision-adapters/openrouter'
import { DecisionModelError } from '../decision-model-schemas'

const API_KEY = 'sk-or-test-key'
const BASE_ENV: EnvLookup = { OPENROUTER_API_KEY: API_KEY }

const originalFetch = global.fetch
let fetchMock: jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fullRequest(): DecisionRequest {
  return {
    state: { ticket: { subject: 'Refund please', amount: 42 } },
    questions: {
      route: {
        type: 'choice',
        instructions: 'Pick the queue',
        options: [
          { key: '10', criteria: 'Ten queue' },
          { key: '2', criteria: 'Two queue' },
          { key: 'billing', criteria: 'Billing queue' },
        ],
      },
      urgency: {
        type: 'score',
        instructions: 'Rate urgency',
        levels: ['low', 'medium', 'high'],
      },
      spam: {
        type: 'binary',
        instructions: 'Is it spam?',
        criteria: { true: 'Spam', false: 'Legit' },
      },
    },
    sessionId: 'wf-instance-1',
  }
}

function successBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'typesafe/jev-1.13',
    answers: {
      route: {
        choice: 'billing',
        confidence: 0.7,
        probabilities: { billing: 0.7, '2': 0.2, '10': 0.1 },
      },
      urgency: {
        score: 1.5,
        confidence: 0.6,
        probabilities: [0.1, 0.3, 0.6],
        legend: ['low', 'medium', 'high'],
      },
      spam: { noul: 0.05 },
      ...overrides,
    },
    usage: { input_tokens: 120, output_tokens: 3, cost: 0.0004 },
  }
}

async function decide(request: DecisionRequest = fullRequest(), env: EnvLookup = BASE_ENV) {
  const adapter = createOpenRouterDecisionAdapter()
  return adapter.decide(request, { modelId: 'typesafe/jev-1.13', env, signal: new AbortController().signal })
}

async function decideError(request?: DecisionRequest): Promise<DecisionModelError> {
  try {
    await decide(request)
  } catch (error) {
    if (error instanceof DecisionModelError) return error
    throw error
  }
  throw new Error('[internal] expected decide to throw')
}

function sentInit(): RequestInit {
  const call = fetchMock.mock.calls[0]
  return call[1] as RequestInit
}

function sentUrl(): string {
  return String(fetchMock.mock.calls[0][0])
}

function sentBodyText(): string {
  return String(sentInit().body)
}

beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('createOpenRouterDecisionAdapter', () => {
  describe('isConfigured', () => {
    const adapter = createOpenRouterDecisionAdapter()

    it('exposes the openrouter id', () => {
      expect(adapter.id).toBe('openrouter')
    })

    it('is configured when OPENROUTER_API_KEY is set', () => {
      expect(adapter.isConfigured({ OPENROUTER_API_KEY: API_KEY })).toBe(true)
    })

    it('is not configured when the key is missing or blank', () => {
      expect(adapter.isConfigured({})).toBe(false)
      expect(adapter.isConfigured({ OPENROUTER_API_KEY: '   ' })).toBe(false)
    })
  })

  describe('request mapping', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody()))
    })

    it('posts to the default base URL with the bearer key', async () => {
      await decide()
      expect(sentUrl()).toBe('https://openrouter.ai/api/alpha/decisions')
      const init = sentInit()
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('uses OM_DECISION_OPENROUTER_BASE_URL with trailing slashes stripped', async () => {
      await decide(fullRequest(), { ...BASE_ENV, OM_DECISION_OPENROUTER_BASE_URL: ' https://proxy.test/api/ ' })
      expect(sentUrl()).toBe('https://proxy.test/api/alpha/decisions')
    })

    it('ignores OPENROUTER_BASE_URL (the LLM preset base)', async () => {
      await decide(fullRequest(), { ...BASE_ENV, OPENROUTER_BASE_URL: 'https://example.test/api/v1' })
      expect(sentUrl()).toBe('https://openrouter.ai/api/alpha/decisions')
    })

    it('keeps choice criteria in option insertion order, including integer-like keys', async () => {
      await decide()
      expect(sentBodyText()).toContain('"criteria":{"10":"Ten queue","2":"Two queue","billing":"Billing queue"}')
    })

    it('maps all three question types, model, state and session_id', async () => {
      await decide()
      const body = JSON.parse(sentBodyText())
      expect(body.model).toBe('typesafe/jev-1.13')
      expect(body.state).toEqual({ ticket: { subject: 'Refund please', amount: 42 } })
      expect(body.session_id).toBe('wf-instance-1')
      expect(body.questions.route.type).toBe('choice')
      expect(body.questions.route.instructions).toBe('Pick the queue')
      expect(body.questions.urgency).toEqual({
        type: 'score',
        instructions: 'Rate urgency',
        criteria: ['low', 'medium', 'high'],
      })
      expect(body.questions.spam).toEqual({
        type: 'noul',
        instructions: 'Is it spam?',
        criteria: { true: 'Spam', false: 'Legit' },
      })
      expect(body).not.toHaveProperty('user')
    })

    it('omits session_id when the request has none', async () => {
      const request = fullRequest()
      delete request.sessionId
      await decide(request)
      const body = JSON.parse(sentBodyText())
      expect(body).not.toHaveProperty('session_id')
      expect(body).not.toHaveProperty('user')
    })
  })

  describe('response mapping', () => {
    it('maps choice probabilities in request order', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody()))
      const result = await decide()
      expect(result.answers.route).toEqual({
        type: 'choice',
        value: 'billing',
        probabilities: [
          { key: '10', probability: 0.1 },
          { key: '2', probability: 0.2 },
          { key: 'billing', probability: 0.7 },
        ],
        confidence: 0.7,
      })
    })

    it('maps score probabilities given as an array', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody()))
      const result = await decide()
      const answer = result.answers.urgency
      if (answer.type !== 'score') throw new Error('[internal] expected a score answer')
      expect(answer.level).toBe(2)
      expect(answer.value).toBeCloseTo(1.5)
      expect(answer.probabilities).toEqual([
        { level: 0, probability: 0.1 },
        { level: 1, probability: 0.3 },
        { level: 2, probability: 0.6 },
      ])
      expect(answer.confidence).toBe(0.6)
    })

    it('maps score probabilities given as an object keyed by level index', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody({
        urgency: { score: 0.4, confidence: 0.7, probabilities: { '2': 0.1, '0': 0.7, '1': 0.2 }, legend: {} },
      })))
      const result = await decide()
      const answer = result.answers.urgency
      if (answer.type !== 'score') throw new Error('[internal] expected a score answer')
      expect(answer.level).toBe(0)
      expect(answer.probabilities).toEqual([
        { level: 0, probability: expect.closeTo(0.7) },
        { level: 1, probability: expect.closeTo(0.2) },
        { level: 2, probability: expect.closeTo(0.1) },
      ])
    })

    it('maps noul to a binary probability', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody()))
      const result = await decide()
      expect(result.answers.spam).toEqual({ type: 'binary', probability: 0.05 })
    })

    it('maps provider, model and usage', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody()))
      const result = await decide()
      expect(result.provider).toBe('openrouter')
      expect(result.model).toBe('typesafe/jev-1.13')
      expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 3, costUsd: 0.0004 })
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns null usage and the requested model when the vendor omits them', async () => {
      const body: Record<string, unknown> = successBody()
      delete body.usage
      delete body.model
      fetchMock.mockResolvedValue(jsonResponse(200, body))
      const result = await decide()
      expect(result.model).toBe('typesafe/jev-1.13')
      expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, costUsd: null })
    })

    it('rejects an unknown key in choice probabilities as invalid_response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody({
        route: {
          choice: 'billing',
          confidence: 0.7,
          probabilities: { billing: 0.7, '2': 0.2, '10': 0.05, shipping: 0.05 },
        },
      })))
      const error = await decideError()
      expect(error.code).toBe('invalid_response')
    })

    it('rejects an answer whose shape cannot be mapped as invalid_response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, successBody({ spam: { choice: 'yes' } })))
      const error = await decideError()
      expect(error.code).toBe('invalid_response')
    })

    it('treats an unparseable 2xx body as provider_error', async () => {
      fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }))
      const error = await decideError()
      expect(error.code).toBe('provider_error')
      expect(error.httpStatus).toBeUndefined()
    })
  })

  describe('HTTP error mapping', () => {
    it.each([
      [400, 'invalid_request'],
      [401, 'auth'],
      [402, 'insufficient_credits'],
      [403, 'auth'],
      [404, 'unavailable'],
      [413, 'payload_too_large'],
      [422, 'invalid_request'],
      [429, 'rate_limited'],
      [500, 'provider_error'],
      [524, 'timeout'],
      [529, 'provider_error'],
    ])('maps HTTP %i to %s', async (status, code) => {
      fetchMock.mockResolvedValue(jsonResponse(status, { error: { code: 'vendor_code', message: 'secret vendor detail' } }))
      const error = await decideError()
      expect(error.code).toBe(code)
      expect(error.httpStatus).toBe(status)
      expect(error.message).toContain('vendor_code')
      expect(error.message).not.toContain('secret vendor detail')
      expect(error.message).not.toContain(API_KEY)
      expect(error.message).not.toContain('Refund please')
    })

    it('tolerates an unparseable error body', async () => {
      fetchMock.mockResolvedValue(new Response('not json', { status: 503 }))
      const error = await decideError()
      expect(error.code).toBe('provider_error')
      expect(error.httpStatus).toBe(503)
    })
  })

  it('rethrows fetch rejections unchanged', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValue(abortError)
    await expect(decide()).rejects.toBe(abortError)
  })
})
