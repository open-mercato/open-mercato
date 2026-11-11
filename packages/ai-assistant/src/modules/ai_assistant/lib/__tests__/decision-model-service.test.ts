import { createContainer } from 'awilix'
import type {
  DecisionModelAdapter,
  DecisionRequest,
  DecisionResult,
} from '@open-mercato/shared/lib/ai/decision-model'
import { register } from '../../di'
import {
  createDecisionModelRegistry,
  type DecisionModelRegistry,
  type DecisionModelResolution,
  type DecisionModelUnavailableReason,
} from '../decision-model-registry'
import { DecisionModelError } from '../decision-model-schemas'
import {
  DEFAULT_DECISION_TIMEOUT_MS,
  MAX_DECISION_TIMEOUT_MS,
  createDecisionModelService,
  type DecisionModelService,
  type DecisionModelServiceLogger,
} from '../decision-model-service'

const SECRET_STATE_VALUE = 'customer-secret-value-7781'
const SECRET_INSTRUCTIONS = 'Pick the routing lane for this confidential order'
const SECRET_SESSION_ID = 'session-opaque-4411'

function buildRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    state: { note: SECRET_STATE_VALUE, lane: 'express' },
    questions: {
      lane: {
        type: 'choice',
        instructions: SECRET_INSTRUCTIONS,
        options: [
          { key: 'express', criteria: 'Fast lane' },
          { key: 'standard', criteria: 'Regular lane' },
        ],
      },
    },
    sessionId: SECRET_SESSION_ID,
    ...overrides,
  }
}

function validResult(): DecisionResult {
  return {
    answers: {
      lane: {
        type: 'choice',
        value: 'express',
        probabilities: [
          { key: 'express', probability: 0.8 },
          { key: 'standard', probability: 0.2 },
        ],
        confidence: 0.8,
      },
    },
    provider: 'stub',
    model: 'stub-model',
    usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
    durationMs: 1,
  }
}

function stubAdapter(decide: DecisionModelAdapter['decide']): DecisionModelAdapter {
  return { id: 'stub', isConfigured: () => true, decide }
}

function fakeRegistry(resolution: DecisionModelResolution): DecisionModelRegistry {
  return {
    register: () => undefined,
    get: () => undefined,
    list: () => [],
    resolve: () => resolution,
  }
}

function silentLogger(): DecisionModelServiceLogger & { info: jest.Mock; warn: jest.Mock } {
  return { info: jest.fn(), warn: jest.fn() }
}

function serviceWith(
  decide: DecisionModelAdapter['decide'],
  extra: { env?: Record<string, string | undefined>; reportError?: jest.Mock; logger?: DecisionModelServiceLogger } = {},
) {
  const adapter = stubAdapter(decide)
  const logger = extra.logger ?? silentLogger()
  const reportError = extra.reportError ?? jest.fn()
  const service = createDecisionModelService({
    registry: fakeRegistry({ ok: true, adapter, modelId: 'stub-model' }),
    env: extra.env ?? {},
    logger,
    reportError,
  })
  return { service, logger, reportError }
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('decisionModelService.decide — success', () => {
  it('answers through the real registry with the fixture adapter', async () => {
    const env = {
      OM_DECISION_FIXTURE_ENABLED: '1',
      NODE_ENV: 'test',
      OM_DECISION_PROVIDER: 'fixture',
      OM_DECISION_MODEL: 'fixture-model',
    }
    const service = createDecisionModelService({
      registry: createDecisionModelRegistry({ env }),
      env,
      logger: silentLogger(),
      reportError: jest.fn(),
    })
    const outcome = await service.decide({
      request: {
        state: { lane: 'express' },
        questions: {
          lane: buildRequest().questions.lane,
          urgency: { type: 'score', instructions: 'How urgent?', levels: ['low', 'mid', 'high'] },
          refund: { type: 'binary', instructions: 'Refund?', criteria: { true: 'yes', false: 'no' } },
        },
      },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.provider).toBe('fixture')
    expect(outcome.result.model).toBe('fixture-model')
    expect(outcome.result.answers.lane).toMatchObject({ type: 'choice', value: 'express' })
    expect(outcome.result.answers.urgency).toMatchObject({ type: 'score', level: 0 })
    expect(outcome.result.answers.refund).toEqual({ type: 'binary', probability: 0.5 })
    expect(outcome.result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('measures durationMs end-to-end with the injected clock', async () => {
    const times = [100, 175]
    const service = createDecisionModelService({
      registry: fakeRegistry({ ok: true, adapter: stubAdapter(async () => validResult()), modelId: 'stub-model' }),
      env: {},
      logger: silentLogger(),
      reportError: jest.fn(),
      now: () => times.shift() ?? 175,
    })
    const outcome = await service.decide({ request: buildRequest() })
    expect(outcome.ok && outcome.result.durationMs).toBe(75)
  })
})

describe('decisionModelService.decide — invalid_request and payload_too_large', () => {
  it('rejects a request that fails the schema', async () => {
    const adapterDecide = jest.fn(async () => validResult())
    const { service } = serviceWith(adapterDecide)
    const outcome = await service.decide({ request: buildRequest({ questions: {} }) })
    expect(outcome).toEqual({ ok: false, error: { code: 'invalid_request', message: expect.any(String) } })
    expect(adapterDecide).not.toHaveBeenCalled()
  })

  it('maps circular state to invalid_request', async () => {
    const state: Record<string, unknown> = { name: 'loop' }
    state.self = state
    const { service } = serviceWith(async () => validResult())
    const outcome = await service.decide({ request: buildRequest({ state }) })
    expect(!outcome.ok && outcome.error.code).toBe('invalid_request')
  })

  it('maps BigInt state to invalid_request', async () => {
    const { service } = serviceWith(async () => validResult())
    const outcome = await service.decide({ request: buildRequest({ state: { amount: BigInt(10) } }) })
    expect(!outcome.ok && outcome.error.code).toBe('invalid_request')
  })

  it('rejects payloads above OM_DECISION_MAX_INPUT_TOKENS', async () => {
    const adapterDecide = jest.fn(async () => validResult())
    const { service } = serviceWith(adapterDecide, { env: { OM_DECISION_MAX_INPUT_TOKENS: '5' } })
    const outcome = await service.decide({ request: buildRequest() })
    expect(!outcome.ok && outcome.error.code).toBe('payload_too_large')
    expect(adapterDecide).not.toHaveBeenCalled()
  })

  it('falls back to the default cap for an invalid OM_DECISION_MAX_INPUT_TOKENS', async () => {
    const { service } = serviceWith(async () => validResult(), { env: { OM_DECISION_MAX_INPUT_TOKENS: '-3' } })
    const outcome = await service.decide({ request: buildRequest() })
    expect(outcome.ok).toBe(true)
  })
})

describe('decisionModelService.decide — unavailable', () => {
  const reasons: DecisionModelUnavailableReason[] = [
    'not_configured',
    'unknown_provider',
    'credentials_missing',
    'model_missing',
    'fixture_disabled',
  ]

  it.each(reasons)('maps resolve reason %s to unavailable', async (reason) => {
    const service = createDecisionModelService({
      registry: fakeRegistry({ ok: false, reason }),
      env: {},
      logger: silentLogger(),
      reportError: jest.fn(),
    })
    const outcome = await service.decide({ request: buildRequest() })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('unavailable')
    expect(outcome.error.message).toContain(reason)
  })
})

describe('decisionModelService.decide — adapter errors', () => {
  it.each([
    ['auth', 401],
    ['insufficient_credits', 402],
    ['rate_limited', 429],
    ['unavailable', 404],
    ['payload_too_large', 413],
    ['invalid_request', 422],
    ['provider_error', 503],
  ] as const)('passes through DecisionModelError %s with its httpStatus', async (code, httpStatus) => {
    const { service } = serviceWith(async () => {
      throw new DecisionModelError(code, 'vendor said no', httpStatus)
    })
    const outcome = await service.decide({ request: buildRequest() })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe(code)
    expect(outcome.error.httpStatus).toBe(httpStatus)
    expect(outcome.error.message).not.toContain('vendor said no')
  })

  it('maps a generic throw to provider_error and reports it', async () => {
    const reportError = jest.fn()
    const { service } = serviceWith(async () => {
      throw new TypeError('socket hang up')
    }, { reportError })
    const outcome = await service.decide({ request: buildRequest() })
    expect(!outcome.ok && outcome.error.code).toBe('provider_error')
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), {
      module: 'ai_assistant',
      code: 'ai_assistant.decision_provider_error',
    })
  })

  it('maps malformed answers to invalid_response and reports it', async () => {
    const reportError = jest.fn()
    const { service } = serviceWith(async () => ({
      ...validResult(),
      answers: {
        lane: {
          type: 'choice',
          value: 'unknown',
          probabilities: [{ key: 'express', probability: 1 }],
          confidence: 1,
        },
      },
    }), { reportError })
    const outcome = await service.decide({ request: buildRequest() })
    expect(!outcome.ok && outcome.error.code).toBe('invalid_response')
    expect(reportError).toHaveBeenCalledWith(expect.any(DecisionModelError), {
      module: 'ai_assistant',
      code: 'ai_assistant.decision_invalid_response',
    })
  })

  it('does not call reportError for non-reported codes', async () => {
    const reportError = jest.fn()
    const { service } = serviceWith(async () => {
      throw new DecisionModelError('rate_limited', 'slow down', 429)
    }, { reportError })
    await service.decide({ request: buildRequest() })
    await service.decide({ request: buildRequest({ questions: {} }) })
    expect(reportError).not.toHaveBeenCalled()
  })
})

describe('decisionModelService.decide — timeout and abort', () => {
  function captureTimeoutDelays(): number[] {
    const delays: number[] = []
    const realSetTimeout = global.setTimeout
    jest.spyOn(global, 'setTimeout').mockImplementation(((handler: () => void, delay?: number) => {
      delays.push(delay ?? 0)
      return realSetTimeout(handler, delay)
    }) as typeof setTimeout)
    return delays
  }

  it.each([
    [60000, MAX_DECISION_TIMEOUT_MS],
    [0, DEFAULT_DECISION_TIMEOUT_MS],
    [-5, DEFAULT_DECISION_TIMEOUT_MS],
    [undefined, DEFAULT_DECISION_TIMEOUT_MS],
    [Number.NaN, DEFAULT_DECISION_TIMEOUT_MS],
    [1200, 1200],
  ])('clamps timeoutMs %p to %p', async (timeoutMs, expected) => {
    const delays = captureTimeoutDelays()
    const { service } = serviceWith(async () => validResult())
    const outcome = await service.decide({ request: buildRequest(), timeoutMs })
    expect(outcome.ok).toBe(true)
    expect(delays).toContain(expected)
  })

  it('ends a hanging adapter that ignores the signal with timeout', async () => {
    const { service } = serviceWith(() => new Promise<DecisionResult>(() => undefined))
    const outcome = await service.decide({ request: buildRequest(), timeoutMs: 20 })
    expect(!outcome.ok && outcome.error.code).toBe('timeout')
  })

  it('reports timeout even when the adapter rethrows the abort as a generic error', async () => {
    const { service } = serviceWith((_request, options) => new Promise<DecisionResult>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('fetch aborted')))
    }))
    const outcome = await service.decide({ request: buildRequest(), timeoutMs: 20 })
    expect(!outcome.ok && outcome.error.code).toBe('timeout')
  })

  it('maps a caller abort mid-flight to aborted', async () => {
    const controller = new AbortController()
    const { service } = serviceWith(() => {
      setTimeout(() => controller.abort(new Error('user cancelled')), 5)
      return new Promise<DecisionResult>(() => undefined)
    })
    const outcome = await service.decide({ request: buildRequest(), timeoutMs: 5000, signal: controller.signal })
    expect(!outcome.ok && outcome.error.code).toBe('aborted')
  })

  it('returns aborted without calling the adapter when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const adapterDecide = jest.fn(async () => validResult())
    const { service } = serviceWith(adapterDecide)
    const outcome = await service.decide({ request: buildRequest(), signal: controller.signal })
    expect(!outcome.ok && outcome.error.code).toBe('aborted')
    expect(adapterDecide).not.toHaveBeenCalled()
  })

  it('passes a combined signal and the model id to the adapter', async () => {
    const adapterDecide = jest.fn<Promise<DecisionResult>, Parameters<DecisionModelAdapter['decide']>>(
      async () => validResult(),
    )
    const { service } = serviceWith(adapterDecide)
    await service.decide({ request: buildRequest() })
    const options = adapterDecide.mock.calls[0]?.[1]
    expect(options?.modelId).toBe('stub-model')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('decisionModelService.decide — resilience and logging', () => {
  it('still returns a result when the logger and reportError throw', async () => {
    const throwingLogger: DecisionModelServiceLogger = {
      info: () => {
        throw new Error('logger down')
      },
      warn: () => {
        throw new Error('logger down')
      },
    }
    const throwingReport = jest.fn(() => {
      throw new Error('telemetry down')
    })
    const okService = serviceWith(async () => validResult(), { logger: throwingLogger, reportError: throwingReport })
    await expect(okService.service.decide({ request: buildRequest() })).resolves.toMatchObject({ ok: true })
    const failService = serviceWith(async () => {
      throw new Error('boom')
    }, { logger: throwingLogger, reportError: throwingReport })
    await expect(failService.service.decide({ request: buildRequest() })).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_error' },
    })
    expect(throwingReport).toHaveBeenCalled()
  })

  it('never resolves to a rejection even for a nonsense input', async () => {
    const { service } = serviceWith(async () => validResult())
    const outcome = await service.decide(undefined as never)
    expect(!outcome.ok && outcome.error.code).toBe('invalid_request')
  })

  it('logs only safe fields and never the state, instructions or session id', async () => {
    const logger = silentLogger()
    const okRun = serviceWith(async () => validResult(), { logger })
    await okRun.service.decide({ request: buildRequest() })
    const failRun = serviceWith(async () => {
      throw new Error(`vendor echoed ${SECRET_STATE_VALUE}`)
    }, { logger })
    await failRun.service.decide({ request: buildRequest() })

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const infoFields = logger.info.mock.calls[0]?.[1]
    expect(Object.keys(infoFields).sort()).toEqual(
      ['durationMs', 'model', 'outcomeCodes', 'provider', 'questionCount', 'usage'].sort(),
    )
    expect(infoFields).toMatchObject({ provider: 'stub', model: 'stub-model', questionCount: 1, outcomeCodes: ['ok'] })
    expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ outcomeCodes: ['provider_error'] })

    const serialized = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])
    expect(serialized).not.toContain(SECRET_STATE_VALUE)
    expect(serialized).not.toContain(SECRET_INSTRUCTIONS)
    expect(serialized).not.toContain(SECRET_SESSION_ID)
    expect(serialized).not.toContain('Fast lane')
  })
})

describe('decisionModelService.getAvailability', () => {
  it('reports the provider and model when resolvable', () => {
    const service = createDecisionModelService({
      registry: fakeRegistry({ ok: true, adapter: stubAdapter(async () => validResult()), modelId: 'stub-model' }),
      env: {},
      logger: silentLogger(),
    })
    expect(service.getAvailability({ moduleId: 'workflows' })).toEqual({
      available: true,
      provider: 'stub',
      model: 'stub-model',
    })
  })

  it('reports the reason when not resolvable', () => {
    const service = createDecisionModelService({
      registry: fakeRegistry({ ok: false, reason: 'credentials_missing' }),
      env: {},
      logger: silentLogger(),
    })
    expect(service.getAvailability()).toEqual({ available: false, reason: 'credentials_missing' })
  })

  it('never throws when the registry fails', () => {
    const registry = fakeRegistry({ ok: false, reason: 'model_missing' })
    registry.resolve = () => {
      throw new Error('registry exploded')
    }
    const service = createDecisionModelService({ registry, env: {}, logger: silentLogger() })
    expect(service.getAvailability()).toEqual({ available: false, reason: 'not_configured' })
  })

  it('uses the per-module model from the real registry', () => {
    const env = {
      OM_DECISION_FIXTURE_ENABLED: '1',
      NODE_ENV: 'test',
      OM_DECISION_PROVIDER: 'fixture',
      OM_DECISION_MODEL: 'global-model',
      OM_DECISION_WORKFLOWS_MODEL: 'workflow-model',
    }
    const service = createDecisionModelService({ registry: createDecisionModelRegistry({ env }), env, logger: silentLogger() })
    expect(service.getAvailability({ moduleId: 'workflows' })).toEqual({
      available: true,
      provider: 'fixture',
      model: 'workflow-model',
    })
  })
})

describe('ai_assistant DI registration', () => {
  it('exposes decisionModelService with decide and getAvailability', () => {
    const container = createContainer()
    register(container)
    const service = container.resolve<DecisionModelService>('decisionModelService')
    expect(typeof service.decide).toBe('function')
    expect(typeof service.getAvailability).toBe('function')
    expect(container.resolve('decisionModelService')).toBe(service)
  })
})
