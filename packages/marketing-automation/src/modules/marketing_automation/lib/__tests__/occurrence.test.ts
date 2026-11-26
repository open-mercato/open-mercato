import { occurrenceKeyFor, OCCURRENCE_DEDUP_WINDOW_HOURS } from '../occurrence'

const scope = { tenantId: 't1', organizationId: 'o1' }

describe('occurrenceKeyFor', () => {
  test('the same delivery produces the same key', () => {
    const payload = { id: 'p1', entityId: 'c1', tenantId: 't1', organizationId: 'o1' }
    expect(occurrenceKeyFor('customers.person.created', scope, payload))
      .toBe(occurrenceKeyFor('customers.person.created', scope, { ...payload }))
  })

  // A payload assembled in a different order is the same payload. Without canonical ordering the
  // duplicate would hash differently and slip straight through the guard.
  test('key order does not change the key', () => {
    const a = occurrenceKeyFor('e', scope, { alpha: 1, beta: { x: 1, y: 2 }, gamma: [1, 2] })
    const b = occurrenceKeyFor('e', scope, { gamma: [1, 2], beta: { y: 2, x: 1 }, alpha: 1 })
    expect(a).toBe(b)
  })

  test('an explicit undefined is the same as an absent key', () => {
    expect(occurrenceKeyFor('e', scope, { id: 'x', extra: undefined })).toBe(occurrenceKeyFor('e', scope, { id: 'x' }))
  })

  test('array order is part of the value', () => {
    expect(occurrenceKeyFor('e', scope, { ids: ['a', 'b'] })).not.toBe(occurrenceKeyFor('e', scope, { ids: ['b', 'a'] }))
  })

  test.each([
    ['a different event', 'other.event', scope, { id: 'p1' }],
    ['a different tenant', 'e', { tenantId: 't2', organizationId: 'o1' }, { id: 'p1' }],
    ['a different organization', 'e', { tenantId: 't1', organizationId: 'o2' }, { id: 'p1' }],
    ['a different subject', 'e', scope, { id: 'p2' }],
    ['an extra field', 'e', scope, { id: 'p1', tagId: 'tag-1' }],
    ['a different value type', 'e', scope, { id: 1 }],
  ])('%s produces a different key', (_label, eventId, keyScope, payload) => {
    expect(occurrenceKeyFor(eventId, keyScope, payload))
      .not.toBe(occurrenceKeyFor('e', scope, { id: 'p1' }))
  })

  test('is a hex digest, so it fits a text column and an index', () => {
    expect(occurrenceKeyFor('e', scope, { id: 'p1' })).toMatch(/^[0-9a-f]{64}$/)
  })

  // Pinned: the key is written to the database, so a change to how it is derived would stop matching
  // the keys already stored and silently re-admit the duplicates they were guarding against.
  test('the derivation is stable across releases', () => {
    expect(occurrenceKeyFor('customers.person.created', scope, { id: 'p1', entityId: 'c1' }))
      .toBe('cac3e8206170ac8e630cf9b04959da8e15a3de772642d53311ae0bfa66eb479e')
  })

  test('the window covers redelivery without reaching re-entry windows', () => {
    // Redeliveries are minutes; the shortest re-entry cooldown an author can express is a day.
    expect(OCCURRENCE_DEDUP_WINDOW_HOURS).toBeGreaterThanOrEqual(1)
    expect(OCCURRENCE_DEDUP_WINDOW_HOURS).toBeLessThan(24)
  })
})
