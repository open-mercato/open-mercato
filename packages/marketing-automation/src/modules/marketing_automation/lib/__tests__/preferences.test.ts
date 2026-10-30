import { MAX_PER_WEEK, normalizeLocale } from '../preferences'
import { MAX_PAUSE_DAYS } from '../engine/gates'

/**
 * The clamps, which is what the portal form leans on.
 *
 * The save path clamps rather than rejects on purpose: this is a customer-facing form, and answering somebody
 * who typed 40 with a validation error is a worse outcome than honouring the nearest sane number. The database
 * round-trip itself is covered by the integration spec.
 */
describe('preference limits', () => {
  it('caps a weekly ceiling at a number somebody could have meant', () => {
    expect(MAX_PER_WEEK).toBe(14)
  })

  it('caps a pause below the point where it is an unsubscribe with extra steps', () => {
    expect(MAX_PAUSE_DAYS).toBe(365)
  })
})

describe('normalizeLocale', () => {
  it('accepts the tags people actually have', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('EN')).toBe('en')
    expect(normalizeLocale('en-gb')).toBe('en-GB')
    expect(normalizeLocale('pl_PL')).toBe('pl-PL')
    expect(normalizeLocale('  de  ')).toBe('de')
  })

  it('refuses anything that is not a language tag', () => {
    /**
     * A stored `english` would sit in the database matching nothing for the rest of its life, and an audience
     * comparing `customer.locale = 'en'` would quietly exclude that person forever.
     */
    for (const value of ['english', 'e', 'en-GBR', '', '   ', '123', 'en-G']) {
      expect(normalizeLocale(value)).toBeNull()
    }
  })

  it('forgives a trailing separator, which cannot produce a wrong language', () => {
    // `en-` is unambiguously `en`; refusing it would fail a form for a stray keystroke.
    expect(normalizeLocale('en-')).toBe('en')
  })
})
