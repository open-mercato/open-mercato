import { parseDateInput, resolveDateRange } from '../dateRange'

describe('resolveDateRange', () => {
  it('resolves last24h', () => {
    const now = new Date('2026-01-27T12:00:00.000Z')
    const { from, to } = resolveDateRange('last24h', null, null, now)
    expect(to.toISOString()).toBe(now.toISOString())
    const diff = to.getTime() - from.getTime()
    expect(diff).toBe(24 * 60 * 60 * 1000)
  })

  it('resolves last7d', () => {
    const now = new Date('2026-01-27T12:00:00.000Z')
    const { from, to } = resolveDateRange('last7d', null, null, now)
    const diff = to.getTime() - from.getTime()
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('resolves custom range', () => {
    const fromInput = parseDateInput('2026-01-20T00:00:00Z')
    const toInput = parseDateInput('2026-01-27T23:59:59Z')
    const { from, to } = resolveDateRange('custom', fromInput, toInput, new Date('2026-01-27T12:00:00Z'))
    expect(from.toISOString()).toBe('2026-01-20T00:00:00.000Z')
    expect(to.toISOString()).toBe('2026-01-27T23:59:59.000Z')
  })
})
