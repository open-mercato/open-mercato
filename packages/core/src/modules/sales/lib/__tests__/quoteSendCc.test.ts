import { QUOTE_SEND_CC_LIMIT } from '../../data/validators'
import { commitPendingCc, isQuoteCcAddress } from '../quoteSendCc'

describe('commitPendingCc', () => {
  const confirmed = ['purchasing@example.com']

  it('keeps the list when nothing is pending', () => {
    expect(commitPendingCc(confirmed, '   ')).toEqual({ ok: true, cc: confirmed })
  })

  it('adds a valid pending address without touching the input list', () => {
    expect(commitPendingCc(confirmed, ' accounting@example.com ')).toEqual({
      ok: true,
      cc: ['purchasing@example.com', 'accounting@example.com'],
    })
    expect(confirmed).toEqual(['purchasing@example.com'])
  })

  it('does not add an address that is already confirmed', () => {
    expect(commitPendingCc(confirmed, 'purchasing@example.com')).toEqual({ ok: true, cc: confirmed })
  })

  it('rejects invalid pending text', () => {
    expect(commitPendingCc(confirmed, 'not-an-email')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a pending address over the limit', () => {
    const full = Array.from({ length: QUOTE_SEND_CC_LIMIT }, (_, index) => `cc-${index}@example.com`)
    expect(commitPendingCc(full, 'one-more@example.com')).toEqual({ ok: false, reason: 'limit' })
  })
})

describe('isQuoteCcAddress', () => {
  it('agrees with the send route schema', () => {
    expect(isQuoteCcAddress('buyer@example.com')).toBe(true)
    expect(isQuoteCcAddress('a..b@example.com')).toBe(false)
  })
})
