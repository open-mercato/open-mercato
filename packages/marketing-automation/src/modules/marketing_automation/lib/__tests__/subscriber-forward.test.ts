const enqueueDispatch = jest.fn()
const reportError = jest.fn()

jest.mock('../queue.js', () => ({ enqueueDispatch: (...a: unknown[]) => enqueueDispatch(...a) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import { forwardEventToCampaigns } from '../subscriber-forward'

/**
 * Every caller of `forwardEventToCampaigns` is a `persistent: true` subscriber, which runs off the
 * command path in the durable events worker. That worker only retries/dead-letters a job whose
 * handler actually threw — so a transient DB probe or enqueue failure has to propagate, not get
 * logged and dropped.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }

function fakeCtx(execute: (...args: unknown[]) => unknown) {
  const em = { getConnection: () => ({ execute }) }
  return { resolve: () => em } as unknown as Parameters<typeof forwardEventToCampaigns>[2]
}

beforeEach(() => {
  enqueueDispatch.mockReset()
  reportError.mockReset()
})

describe('forwardEventToCampaigns', () => {
  it('propagates a listener-probe failure instead of swallowing it', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('[internal] connection reset'))
    await expect(
      forwardEventToCampaigns('sales.order.confirmed', { ...scope }, fakeCtx(execute)),
    ).rejects.toThrow('connection reset')
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('propagates an enqueue failure instead of swallowing it', async () => {
    const execute = jest.fn().mockResolvedValue([{ listening: 1 }])
    enqueueDispatch.mockRejectedValue(new Error('[internal] queue unavailable'))
    await expect(
      forwardEventToCampaigns('sales.order.confirmed', { ...scope }, fakeCtx(execute)),
    ).rejects.toThrow('queue unavailable')
  })

  it('does nothing, and does not throw, when no campaign is listening', async () => {
    const execute = jest.fn().mockResolvedValue([])
    await forwardEventToCampaigns('sales.order.confirmed', { ...scope }, fakeCtx(execute))
    expect(enqueueDispatch).not.toHaveBeenCalled()
  })

  it('does nothing when the payload carries no tenant/organization scope', async () => {
    const execute = jest.fn()
    await forwardEventToCampaigns('sales.order.confirmed', {}, fakeCtx(execute))
    expect(execute).not.toHaveBeenCalled()
    expect(enqueueDispatch).not.toHaveBeenCalled()
  })
})
