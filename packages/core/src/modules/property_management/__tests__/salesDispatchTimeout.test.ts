/** @jest-environment node */
import {
  FALLBACK_SALES_DISPATCH_TIMEOUT_MS,
  guardSalesDispatcher,
  resolveSalesDispatchTimeoutMs,
  SalesDispatchTimeoutError,
  type SalesDispatcher,
} from '../lib/salesDispatcher'
import { classifySalesError } from '../lib/salesErrors'

describe('resolveSalesDispatchTimeoutMs', () => {
  it('stays a quarter below the default idle-in-transaction limit', () => {
    expect(resolveSalesDispatchTimeoutMs({ NODE_ENV: 'test' })).toBe(90_000)
  })

  it('follows a configured idle-in-transaction limit', () => {
    expect(resolveSalesDispatchTimeoutMs({ NODE_ENV: 'test', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '20000' })).toBe(15_000)
  })

  it('falls back to a bounded wait when Postgres never ends idle transactions', () => {
    expect(resolveSalesDispatchTimeoutMs({ NODE_ENV: 'test', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' })).toBe(FALLBACK_SALES_DISPATCH_TIMEOUT_MS)
  })
})

describe('guardSalesDispatcher', () => {
  function dispatcherWith(overrides: Partial<SalesDispatcher>): SalesDispatcher {
    return overrides as SalesDispatcher
  }

  it('checks the caller before each call and passes results through', async () => {
    const beforeCall = jest.fn(async () => undefined)
    const guarded = guardSalesDispatcher(dispatcherWith({ createQuote: jest.fn(async () => 'quote-1') }), { timeoutMs: 1_000, beforeCall })
    expect(await guarded.createQuote({})).toBe('quote-1')
    expect(beforeCall).toHaveBeenCalledTimes(1)
  })

  it('does not call sales when the caller check fails', async () => {
    const createOrder = jest.fn(async () => 'order-1')
    const guarded = guardSalesDispatcher(dispatcherWith({ createOrder }), {
      timeoutMs: 1_000,
      beforeCall: async () => {
        throw Object.assign(new Error('terminating connection'), { code: '57P01' })
      },
    })
    await expect(guarded.createOrder({})).rejects.toThrow('terminating connection')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('rejects a call that outlives the timeout as a transient error and reports a late creation', async () => {
    const onLateCreate = jest.fn()
    let release: (value: string) => void = () => undefined
    const guarded = guardSalesDispatcher(
      dispatcherWith({ createOrder: jest.fn(() => new Promise<string>((done) => { release = done })) }),
      { timeoutMs: 10, onLateCreate },
    )
    const error = await guarded.createOrder({}).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(SalesDispatchTimeoutError)
    expect(classifySalesError(error)).toMatchObject({ kind: 'transient', code: 'sales_dispatch_timeout' })
    expect(onLateCreate).not.toHaveBeenCalled()
    release('order-late')
    await new Promise((done) => setImmediate(done))
    expect(onLateCreate).toHaveBeenCalledTimes(1)
  })
})
