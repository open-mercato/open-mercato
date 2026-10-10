/** @jest-environment node */
import { paymentLockHeaders } from '../paymentLock'

const HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

describe('freight payment optimistic-lock targets', () => {
  it('guards a recording with the invoiced document version', () => {
    expect(paymentLockHeaders('record', { updatedAt: '2026-10-10T06:00:00.000Z' })).toEqual({
      [HEADER]: '2026-10-10T06:00:00.000Z',
    })
  })

  it('guards a void with the payment row version', () => {
    expect(paymentLockHeaders('void', { updated_at: '2026-10-10T07:00:00.000Z' })).toEqual({
      [HEADER]: '2026-10-10T07:00:00.000Z',
    })
  })

  // Resync is a repair action: the command enforces no lock, and sending one
  // would turn a recovery tool into a source of spurious 409s.
  it('sends no version for a resync', () => {
    expect(paymentLockHeaders('resync', { updatedAt: '2026-10-10T08:00:00.000Z' })).toEqual({})
  })

  it('omits the header when the source carries no version', () => {
    expect(paymentLockHeaders('record', null)).toEqual({})
    expect(paymentLockHeaders('void', undefined)).toEqual({})
  })
})
