import {
  CLOSED_DEAL_STATUS_LIST,
  DEAL_STATUS_CLOSED,
  DEAL_STATUS_LOSE,
  DEAL_STATUS_WIN,
  LOST_DEAL_STATUS_LIST,
  WON_DEAL_STATUS_LIST,
  canonicalDealStatus,
  expandDealStatusAliases,
  isClosedDealStatus,
  isLostDealStatus,
  isOpenDealStatus,
  isWonDealStatus,
} from '../dealStatus'

describe('deal status semantics', () => {
  describe('isClosedDealStatus', () => {
    it.each(['win', 'won', 'loose', 'lost', 'closed'])('treats %s as closed', (value) => {
      expect(isClosedDealStatus(value)).toBe(true)
    })

    it.each(['open', 'lead', 'offering', 'negotiations', 'stalled'])(
      'treats seeded open status %s as not closed',
      (value) => {
        expect(isClosedDealStatus(value)).toBe(false)
      },
    )

    it('treats a tenant-specific unknown status as not closed', () => {
      expect(isClosedDealStatus('awaiting_legal_signoff')).toBe(false)
    })

    it('treats null/undefined as not closed', () => {
      expect(isClosedDealStatus(null)).toBe(false)
      expect(isClosedDealStatus(undefined)).toBe(false)
    })
  })

  describe('isOpenDealStatus', () => {
    it.each(['open', 'negotiations', 'awaiting_legal_signoff'])('treats %s as open', (value) => {
      expect(isOpenDealStatus(value)).toBe(true)
    })

    it.each(['win', 'won', 'loose', 'lost', 'closed'])('treats closed status %s as not open', (value) => {
      expect(isOpenDealStatus(value)).toBe(false)
    })

    it('treats null/undefined as open, so a status-less deal stays visible', () => {
      expect(isOpenDealStatus(null)).toBe(true)
      expect(isOpenDealStatus(undefined)).toBe(true)
    })
  })

  describe('isWonDealStatus', () => {
    it.each(['win', 'won'])('treats %s as won', (value) => {
      expect(isWonDealStatus(value)).toBe(true)
    })

    it.each(['loose', 'lost', 'closed', 'open', null, undefined])('treats %s as not won', (value) => {
      expect(isWonDealStatus(value)).toBe(false)
    })
  })

  describe('isLostDealStatus', () => {
    it.each(['loose', 'lost'])('treats %s as lost', (value) => {
      expect(isLostDealStatus(value)).toBe(true)
    })

    it.each(['win', 'won', 'closed', 'open', null, undefined])('treats %s as not lost', (value) => {
      expect(isLostDealStatus(value)).toBe(false)
    })
  })

  it('exposes the canonical status constants persisted by the UI closure flows', () => {
    expect(DEAL_STATUS_WIN).toBe('win')
    expect(DEAL_STATUS_LOSE).toBe('loose')
    expect(DEAL_STATUS_CLOSED).toBe('closed')
  })

  it('covers both spellings every writer persists', () => {
    expect([...WON_DEAL_STATUS_LIST].sort()).toEqual(['win', 'won'])
    expect([...LOST_DEAL_STATUS_LIST].sort()).toEqual(['loose', 'lost'])
    expect([...CLOSED_DEAL_STATUS_LIST].sort()).toEqual(['closed', 'loose', 'lost', 'win', 'won'])
  })

  it('keeps won and lost disjoint', () => {
    for (const value of WON_DEAL_STATUS_LIST) {
      expect(isLostDealStatus(value)).toBe(false)
    }
    for (const value of LOST_DEAL_STATUS_LIST) {
      expect(isWonDealStatus(value)).toBe(false)
    }
  })

  describe('canonicalDealStatus', () => {
    it('normalizes won→win and lost→loose', () => {
      expect(canonicalDealStatus('won')).toBe('win')
      expect(canonicalDealStatus('Won')).toBe('win')
      expect(canonicalDealStatus('WON')).toBe('win')
      expect(canonicalDealStatus('lost')).toBe('loose')
      expect(canonicalDealStatus('LOST')).toBe('loose')
    })

    it('keeps canonical and unknown values unchanged case-wise', () => {
      expect(canonicalDealStatus('win')).toBe('win')
      expect(canonicalDealStatus('open')).toBe('open')
      expect(canonicalDealStatus('renegotiating')).toBe('renegotiating')
    })
  })

  describe('expandDealStatusAliases', () => {
    it('expands win/won to both spellings and loose/lost to both', () => {
      expect(expandDealStatusAliases(['win']).sort()).toEqual(['win', 'won'])
      expect(expandDealStatusAliases(['won']).sort()).toEqual(['win', 'won'])
      expect(expandDealStatusAliases(['WON']).sort()).toEqual(['win', 'won'])
      expect(expandDealStatusAliases(['loose']).sort()).toEqual(['loose', 'lost'])
      expect(expandDealStatusAliases(['lost']).sort()).toEqual(['loose', 'lost'])
    })

    it('expands closed to the full terminal set', () => {
      expect(expandDealStatusAliases(['closed']).sort()).toEqual(
        [...CLOSED_DEAL_STATUS_LIST].sort(),
      )
    })

    it('is case-insensitive and preserves unknown values', () => {
      expect(expandDealStatusAliases(['WON', 'Open']).sort()).toEqual(['Open', 'win', 'won'].sort())
      expect(expandDealStatusAliases(['renegotiating'])).toEqual(['renegotiating'])
    })

    it('deduplicates when both spellings are provided', () => {
      expect(expandDealStatusAliases(['win', 'won']).sort()).toEqual(['win', 'won'])
      expect(expandDealStatusAliases(['win', 'WON', 'win']).sort()).toEqual(['win', 'won'])
    })
  })
})
