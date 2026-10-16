import type { DecisionRequest } from '@open-mercato/shared/lib/ai/decision-model'

const debugMock = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const childLogger = { debug: (...args: unknown[]) => debugMock(...args), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { createLogger: () => ({ ...childLogger, child: () => childLogger }) }
})

import { normalizeDecisionAnswers } from '../decision-model-schemas'

const request: DecisionRequest = {
  state: { secret: 'customer-email@example.test' },
  questions: {
    route: {
      type: 'choice',
      instructions: 'Pick the queue',
      options: [{ key: 'billing', criteria: 'Billing' }, { key: 'support', criteria: 'Support' }],
    },
  },
}

describe('normalizeDecisionAnswers logging', () => {
  beforeEach(() => debugMock.mockClear())

  it('logs at debug when a near-1 distribution is normalized, without state or instructions', () => {
    normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'billing', probabilities: [{ key: 'billing', probability: 0.6 }, { key: 'support', probability: 0.41 }], confidence: 0.6 },
    })
    expect(debugMock).toHaveBeenCalledTimes(1)
    const serialized = JSON.stringify(debugMock.mock.calls)
    expect(serialized).toContain('route')
    expect(serialized).not.toContain('customer-email@example.test')
    expect(serialized).not.toContain('Pick the queue')
  })

  it('does not log when the distribution already sums to 1', () => {
    normalizeDecisionAnswers(request, {
      route: { type: 'choice', value: 'billing', probabilities: [{ key: 'billing', probability: 0.6 }, { key: 'support', probability: 0.4 }], confidence: 0.6 },
    })
    expect(debugMock).not.toHaveBeenCalled()
  })
})
