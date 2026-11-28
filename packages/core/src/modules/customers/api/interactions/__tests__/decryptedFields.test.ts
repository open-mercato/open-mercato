import { fieldNameCandidates } from '@open-mercato/shared/lib/query/encrypted-sort'
import { createDecryptedFieldsOverlay } from '../decryptedFields'

jest.mock('@open-mercato/shared/lib/query/encrypted-sort', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/shared/lib/query/encrypted-sort')>(
    '@open-mercato/shared/lib/query/encrypted-sort',
  )
  return { ...actual, fieldNameCandidates: jest.fn(actual.fieldNameCandidates) }
})

function applyDecryptedFields<T extends Record<string, unknown>>(
  item: T,
  record: object | undefined,
  fields: readonly string[],
): T {
  return createDecryptedFieldsOverlay(new Map([['parent', fields]]))(item, record, 'parent')
}

describe('applyDecryptedFields (#5945)', () => {
  test('overrides every response key the encryption map declares, not just title/body', () => {
    const item = { id: 'a', title: 'cipher-title', body: 'cipher-body', location: 'cipher-location' }
    const record = { id: 'a', title: 'Kickoff', body: 'Notes', location: 'https://meet.example/room' }

    expect(applyDecryptedFields(item, record, ['title', 'body', 'location'])).toEqual({
      id: 'a',
      title: 'Kickoff',
      body: 'Notes',
      location: 'https://meet.example/room',
    })
  })

  test('matches a snake_case map field against its camelCase response key and entity property', () => {
    const item = { id: 'a', recurrenceRule: 'cipher-rule' }
    const record = { id: 'a', recurrenceRule: 'FREQ=WEEKLY' }

    expect(applyDecryptedFields(item, record, ['recurrence_rule']).recurrenceRule).toBe('FREQ=WEEKLY')
  })

  test('carries non-string decrypted values through unchanged', () => {
    const item = { id: 'a', participants: 'cipher-participants' as unknown }
    const participants = [{ email: 'guest@example.test' }]

    expect(applyDecryptedFields(item, { id: 'a', participants }, ['participants']).participants).toBe(participants)
  })

  test('normalizes an absent decrypted value to null rather than undefined', () => {
    const item = { id: 'a', title: 'cipher-title' as string | null }

    expect(applyDecryptedFields(item, { id: 'a', title: undefined }, ['title']).title).toBeNull()
    expect(applyDecryptedFields(item, { id: 'a', title: null }, ['title']).title).toBeNull()
  })

  test('serializes a decrypted Date so the response keeps its ISO string shape', () => {
    const item = { id: 'a', recurrenceEnd: 'cipher-end' as unknown }
    const record = { id: 'a', recurrenceEnd: new Date('2026-03-01T10:00:00.000Z') }

    expect(applyDecryptedFields(item, record, ['recurrence_end']).recurrenceEnd).toBe('2026-03-01T10:00:00.000Z')
  })

  test('leaves the item untouched when there is no decrypted record or no declared field', () => {
    const item = { id: 'a', title: 'raw-title' }

    expect(applyDecryptedFields(item, undefined, ['title'])).toBe(item)
    expect(applyDecryptedFields(item, { id: 'a', title: 'decrypted' }, [])).toBe(item)
  })

  test('never introduces a response key the item does not already expose', () => {
    const item = { id: 'a', title: 'cipher-title' }
    const patched = applyDecryptedFields(item, { id: 'a', title: 'Kickoff', location: 'Room 4' }, ['title', 'location'])

    expect(Object.keys(patched).sort()).toEqual(['id', 'title'])
  })

  test('resolves each map field once across the page and keeps each organization’s field set', () => {
    jest.mocked(fieldNameCandidates).mockClear()
    const applyOverlay = createDecryptedFieldsOverlay(new Map([
      ['parent', ['recurrence_rule']],
      ['child', ['recurrence_rule', 'location']],
    ]))
    const item = { recurrenceRule: 'raw-rule', location: 'raw-location' }
    const record = { recurrenceRule: 'FREQ=WEEKLY', location: 'Room 4' }

    expect(applyOverlay(item, { location: 'Room 4' }, 'parent')).toBe(item)
    expect(applyOverlay(item, record, 'parent')).toEqual({ ...item, recurrenceRule: 'FREQ=WEEKLY' })
    expect(applyOverlay(item, record, 'child')).toEqual(record)
    expect(jest.mocked(fieldNameCandidates).mock.calls).toEqual([['recurrence_rule'], ['location']])
  })
})
