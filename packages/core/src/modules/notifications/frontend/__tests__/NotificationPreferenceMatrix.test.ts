import {
  buildPreferenceMap,
  diffPreferenceItems,
  preferenceKey,
  PREFERENCE_CHANNELS,
  type NotificationTypeItem,
} from '../NotificationPreferenceMatrix'

const types: NotificationTypeItem[] = [
  { id: 'a.one', labelKey: 'a.one.title' },
  { id: 'b.two', labelKey: 'b.two.title' },
]

describe('NotificationPreferenceMatrix helpers', () => {
  it('buildPreferenceMap defaults missing entries to enabled and honors stored rows', () => {
    const map = buildPreferenceMap(types, [{ notificationTypeId: 'a.one', channel: 'push', enabled: false }])
    expect(map[preferenceKey('a.one', 'push')]).toBe(false)
    expect(map[preferenceKey('a.one', 'in_app')]).toBe(true)
    expect(map[preferenceKey('b.two', 'push')]).toBe(true)
    // Every type x channel cell is materialized in the in-memory map.
    expect(Object.keys(map)).toHaveLength(types.length * PREFERENCE_CHANNELS.length)
  })

  it('diffPreferenceItems returns only entries that differ from the baseline', () => {
    const initial = buildPreferenceMap(types, [])
    const current = { ...initial, [preferenceKey('a.one', 'push')]: false }
    const diff = diffPreferenceItems(types, initial, current)
    expect(diff).toEqual([{ notificationTypeId: 'a.one', channel: 'push', enabled: false }])
  })

  it('diffPreferenceItems is empty when nothing changed (no redundant rows, no event)', () => {
    const initial = buildPreferenceMap(types, [])
    expect(diffPreferenceItems(types, initial, { ...initial })).toEqual([])
  })

  it('diffPreferenceItems detects a re-enable (false -> true) so the explicit row round-trips', () => {
    const initial = buildPreferenceMap(types, [{ notificationTypeId: 'a.one', channel: 'push', enabled: false }])
    const current = { ...initial, [preferenceKey('a.one', 'push')]: true }
    expect(diffPreferenceItems(types, initial, current)).toEqual([
      { notificationTypeId: 'a.one', channel: 'push', enabled: true },
    ])
  })
})
