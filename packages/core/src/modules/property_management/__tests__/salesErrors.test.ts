import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { classifySalesError, SalesContractUnavailableError } from '../lib/salesErrors'

describe('classifySalesError', () => {
  it('treats sales 4xx codes as permanent refusals', () => {
    for (const code of ['recurring_order_locked', 'recurring_order_already_cancelled', 'recurring_order_invoiced', 'recurring_cancel_would_credit']) {
      expect(classifySalesError(new CrudHttpError(409, { error: 'x', code })).kind).toBe('permanent')
    }
    expect(classifySalesError(new CrudHttpError(422, { error: 'invalid' })).kind).toBe('permanent')
    expect(classifySalesError(z.object({ a: z.string() }).safeParse({}).error).kind).toBe('permanent')
  })

  it('treats a stale schedule version as transient', () => {
    expect(classifySalesError(new CrudHttpError(409, { error: 'Stale schedule', code: 'recurring_schedule_version_stale' })).kind).toBe('transient')
  })

  it('treats 5xx, connection and lock errors as transient', () => {
    expect(classifySalesError(new CrudHttpError(503, { error: 'down' })).kind).toBe('transient')
    expect(classifySalesError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).kind).toBe('transient')
    expect(classifySalesError(Object.assign(new Error('deadlock'), { code: '40P01' })).kind).toBe('transient')
    expect(classifySalesError(new Error('unknown')).kind).toBe('transient')
  })

  it('reports 404 as not found and missing sales capabilities as unavailable', () => {
    expect(classifySalesError(new CrudHttpError(404, { error: 'gone' })).kind).toBe('not_found')
    const unavailable = classifySalesError(new SalesContractUnavailableError('sales.orders.recurrence.cancel'))
    expect(unavailable.kind).toBe('unavailable')
    expect(unavailable.message).toContain('[internal]')
  })

  it('keeps the sales code and message', () => {
    const classified = classifySalesError(new CrudHttpError(409, { error: 'Would credit', code: 'recurring_cancel_would_credit' }))
    expect(classified).toEqual({ kind: 'permanent', status: 409, code: 'recurring_cancel_would_credit', message: 'Would credit' })
  })
})
