/**
 * Start fixtures — named START contexts (spec section 8.1).
 */

import {
  WORKFLOW_START_FIXTURES_MAX_CHARS,
  WORKFLOW_START_FIXTURES_MAX_COUNT,
  WORKFLOW_START_FIXTURE_NAME_MAX,
  listStartFixtures,
  removeStartFixture,
  upsertStartFixture,
  type WorkflowStartFixtures,
} from '../start-fixtures'

const AT = '2026-07-29T10:00:00.000Z'

function seed(count: number): WorkflowStartFixtures {
  const fixtures: WorkflowStartFixtures = {}
  for (let index = 0; index < count; index += 1) {
    fixtures[`fixture-${index}`] = { name: `fixture-${index}`, savedAt: AT, context: {} }
  }
  return fixtures
}

describe('upsertStartFixture', () => {
  test('adds a named start context', () => {
    const result = upsertStartFixture(null, 'happy path', { dealId: 'd-1' }, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fixtures['happy path']).toEqual({
      name: 'happy path',
      savedAt: AT,
      context: { dealId: 'd-1' },
    })
  })

  test('trims the name so "happy path " and "happy path" are one fixture', () => {
    const first = upsertStartFixture(null, 'happy path', { a: 1 }, AT)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = upsertStartFixture(first.fixtures, ' happy path ', { a: 2 }, AT)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(Object.keys(second.fixtures)).toEqual(['happy path'])
    expect(second.fixtures['happy path'].context).toEqual({ a: 2 })
  })

  test('refuses an empty or oversized name', () => {
    expect(upsertStartFixture(null, '   ', {}, AT)).toEqual({ ok: false, reason: 'emptyName' })
    expect(
      upsertStartFixture(null, 'x'.repeat(WORKFLOW_START_FIXTURE_NAME_MAX + 1), {}, AT),
    ).toEqual({ ok: false, reason: 'nameTooLong' })
  })

  test('caps the number of fixtures', () => {
    const full = seed(WORKFLOW_START_FIXTURES_MAX_COUNT)
    expect(upsertStartFixture(full, 'one more', {}, AT)).toEqual({ ok: false, reason: 'tooMany' })
  })

  test('replacing an existing fixture still works at the count cap', () => {
    const full = seed(WORKFLOW_START_FIXTURES_MAX_COUNT)
    const result = upsertStartFixture(full, 'fixture-0', { replaced: true }, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.fixtures)).toHaveLength(WORKFLOW_START_FIXTURES_MAX_COUNT)
    expect(result.fixtures['fixture-0'].context).toEqual({ replaced: true })
  })

  test('caps the total size', () => {
    const huge = { blob: 'x'.repeat(WORKFLOW_START_FIXTURES_MAX_CHARS) }
    expect(upsertStartFixture(null, 'huge', huge, AT)).toEqual({ ok: false, reason: 'tooLarge' })
  })

  test('never mutates the collection it was given', () => {
    const original = seed(1)
    const snapshot = JSON.stringify(original)
    upsertStartFixture(original, 'another', {}, AT)
    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('removeStartFixture', () => {
  test('removes by trimmed name and leaves the rest alone', () => {
    const seeded = seed(3)
    const next = removeStartFixture(seeded, ' fixture-1 ')
    expect(Object.keys(next).sort()).toEqual(['fixture-0', 'fixture-2'])
    expect(Object.keys(seeded)).toHaveLength(3)
  })
})

describe('listStartFixtures', () => {
  test('orders newest first with the name as a stable tiebreaker', () => {
    const fixtures: WorkflowStartFixtures = {
      b: { name: 'b', savedAt: '2026-07-29T10:00:00.000Z', context: {} },
      a: { name: 'a', savedAt: '2026-07-29T10:00:00.000Z', context: {} },
      c: { name: 'c', savedAt: '2026-07-29T11:00:00.000Z', context: {} },
    }
    expect(listStartFixtures(fixtures).map((fixture) => fixture.name)).toEqual(['c', 'a', 'b'])
  })

  test('an absent collection lists nothing', () => {
    expect(listStartFixtures(null)).toEqual([])
  })
})
