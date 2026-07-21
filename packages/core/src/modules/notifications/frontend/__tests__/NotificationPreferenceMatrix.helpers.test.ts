import {
  buildPreferenceMap,
  diffPreferenceItems,
  isChannelDisabledForType,
  preferenceKey,
  PREFERENCE_CHANNELS,
  type NotificationTypeItem,
  type PreferenceItem,
} from '../NotificationPreferenceMatrix'
import { computeChannelsPatch, computeNextChannels } from '../typeChannelSettings'

const CHANNELS = PREFERENCE_CHANNELS
const FIRST = CHANNELS[0]!.key
const REST = CHANNELS.slice(1).map((channel) => channel.key)

describe('isChannelDisabledForType', () => {
  it('is false when the type declares no eligibility (null/absent = every channel)', () => {
    expect(isChannelDisabledForType({ id: 'a', labelKey: 'a' }, FIRST)).toBe(false)
    expect(isChannelDisabledForType({ id: 'a', labelKey: 'a', channels: null }, FIRST)).toBe(false)
  })

  it('is true only for channels outside the eligible set', () => {
    const type: NotificationTypeItem = { id: 'a', labelKey: 'a', channels: REST }
    expect(isChannelDisabledForType(type, FIRST)).toBe(true)
    for (const key of REST) expect(isChannelDisabledForType(type, key)).toBe(false)
  })

  it('an empty eligible set disables every channel', () => {
    const type: NotificationTypeItem = { id: 'a', labelKey: 'a', channels: [] }
    for (const channel of CHANNELS) expect(isChannelDisabledForType(type, channel.key)).toBe(true)
  })
})

describe('buildPreferenceMap (ineligible cells forced off)', () => {
  const type: NotificationTypeItem = { id: 'a', labelKey: 'a', channels: REST }

  it('forces an ineligible cell to false even when a stored row opts in', () => {
    const stored: PreferenceItem[] = [{ notificationTypeId: 'a', channel: FIRST, enabled: true }]
    const map = buildPreferenceMap([type], stored, CHANNELS)
    expect(map[preferenceKey('a', FIRST)]).toBe(false)
  })

  it('keeps default-on and stored values for eligible cells', () => {
    const stored: PreferenceItem[] = [{ notificationTypeId: 'a', channel: REST[0]!, enabled: false }]
    const map = buildPreferenceMap([type], stored, CHANNELS)
    expect(map[preferenceKey('a', REST[0]!)]).toBe(false)
    if (REST[1]) expect(map[preferenceKey('a', REST[1])]).toBe(true)
  })
})

describe('diffPreferenceItems (ineligible cells never produce writes)', () => {
  const type: NotificationTypeItem = { id: 'a', labelKey: 'a', channels: REST }

  it('skips changes on ineligible cells', () => {
    const initial = buildPreferenceMap([type], [], CHANNELS)
    const current = { ...initial, [preferenceKey('a', FIRST)]: true }
    const items = diffPreferenceItems([type], initial, current, CHANNELS)
    expect(items).toEqual([])
  })

  it('still emits changes for eligible cells', () => {
    const initial = buildPreferenceMap([type], [], CHANNELS)
    const current = { ...initial, [preferenceKey('a', REST[0]!)]: false }
    const items = diffPreferenceItems([type], initial, current, CHANNELS)
    expect(items).toEqual([{ notificationTypeId: 'a', channel: REST[0], enabled: false }])
  })
})

describe('computeNextChannels (admin type-channel toggle)', () => {
  it('adds the toggled channel without duplicating it', () => {
    expect(computeNextChannels(['in_app', 'email'], 'push', true)).toEqual(['in_app', 'email', 'push'])
    expect(computeNextChannels(['in_app', 'push'], 'push', true)).toEqual(['in_app', 'push'])
  })

  it('removes the toggled channel', () => {
    expect(computeNextChannels(['in_app', 'email', 'push'], 'push', false)).toEqual(['in_app', 'email'])
  })

  it('can empty the set entirely (blocks every channel for the type)', () => {
    expect(computeNextChannels(['in_app'], 'in_app', false)).toEqual([])
  })
})

describe('computeChannelsPatch (last-uncheck maps to null, not [])', () => {
  it('returns the next set when a channel remains', () => {
    expect(computeChannelsPatch(['in_app', 'email', 'push'], 'push', false)).toEqual(['in_app', 'email'])
    expect(computeChannelsPatch(['in_app'], 'email', true)).toEqual(['in_app', 'email'])
  })

  it('returns null when unchecking the last channel (clear the override instead of black-holing)', () => {
    expect(computeChannelsPatch(['in_app'], 'in_app', false)).toBeNull()
  })
})
