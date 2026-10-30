import { chooseAssignee, digestIsWorthSending } from '../engine/lead-routing'

describe('chooseAssignee', () => {
  it('gives the lead to whoever has the fewest', () => {
    const decision = chooseAssignee({ pool: ['a', 'b', 'c'], load: { a: 5, b: 2, c: 9 } })
    expect(decision).toEqual({ assign: true, userId: 'b' })
  })

  it('treats a rep with no leads as having none rather than skipping them', () => {
    // A rep absent from the load map is new, not unavailable — and they are exactly who should get the lead.
    expect(chooseAssignee({ pool: ['a', 'new'], load: { a: 3 } })).toEqual({ assign: true, userId: 'new' })
  })

  it('breaks ties deterministically, so a re-run assigns the same rep', () => {
    const input = { pool: ['zoe', 'adam', 'mia'], load: { zoe: 4, adam: 4, mia: 4 } }
    expect(chooseAssignee(input)).toEqual({ assign: true, userId: 'adam' })
    expect(chooseAssignee(input)).toEqual(chooseAssignee(input))
  })

  it('leaves an owned lead with its owner by default', () => {
    /**
     * The most damaging thing routing can do is take a customer away from the rep who has been talking to
     * them, and a campaign re-entry would do it on every pass if this defaulted the other way.
     */
    expect(chooseAssignee({ pool: ['a', 'b'], load: {}, currentOwnerUserId: 'someone-else' }))
      .toEqual({ assign: false, reason: 'already_owned' })
  })

  it('reassigns only when asked', () => {
    expect(chooseAssignee({ pool: ['a', 'b'], load: { a: 9, b: 1 }, currentOwnerUserId: 'a', reassign: true }))
      .toEqual({ assign: true, userId: 'b' })
  })

  it('says the pool is empty rather than inventing a rep', () => {
    expect(chooseAssignee({ pool: [], load: {} })).toEqual({ assign: false, reason: 'empty_pool' })
    expect(chooseAssignee({ pool: ['  ', ''], load: {} })).toEqual({ assign: false, reason: 'empty_pool' })
  })

  it('ignores a rep listed twice, which would otherwise halve everybody else share', () => {
    expect(chooseAssignee({ pool: ['a', 'a', 'b'], load: { a: 1, b: 2 } })).toEqual({ assign: true, userId: 'a' })
  })
})

describe('digestIsWorthSending', () => {
  it('sends only when something arrived', () => {
    expect(digestIsWorthSending({ userId: 'a', newLeads: [{ id: '1', displayName: 'Lead' }], totalOwned: 10 })).toBe(true)
  })

  it('stays quiet on an empty week, whatever the total', () => {
    // "You got no new leads" is the notification that teaches people to ignore notifications.
    expect(digestIsWorthSending({ userId: 'a', newLeads: [], totalOwned: 400 })).toBe(false)
  })
})
