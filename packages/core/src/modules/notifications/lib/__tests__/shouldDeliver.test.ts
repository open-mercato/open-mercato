import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import {
  resolveEligibleChannels,
  resolveEffectiveChannels,
  shouldDeliver,
  type ChannelPreferenceReader,
} from '../shouldDeliver'

const SCOPE = { tenantId: 't1', userId: 'u1' }
const REGISTERED = ['in_app', 'email', 'push']

function def(type: string, extra: Partial<NotificationTypeDefinition> = {}): NotificationTypeDefinition {
  return { type, module: 'test', titleKey: `${type}.title`, icon: 'bell', severity: 'info', actions: [], ...extra }
}

/** Preference reader whose disabled `(typeId, channel)` pairs return false; everything else default-on. */
function prefs(disabled: Array<[string, string]> = []): ChannelPreferenceReader {
  const off = new Set(disabled.map(([typeId, channel]) => `${typeId}:${channel}`))
  return { isChannelEnabled: async (_scope, typeId, channel) => !off.has(`${typeId}:${channel}`) }
}

function base(overrides: Partial<Parameters<typeof shouldDeliver>[0]> = {}) {
  return {
    typeId: 'orders.created',
    type: def('orders.created'),
    scope: SCOPE,
    registeredChannels: REGISTERED,
    preferences: prefs(),
    ...overrides,
  }
}

describe('shouldDeliver', () => {
  it('delivers every registered channel by default (no target, no eligibility, no opt-out)', async () => {
    const channels = await resolveEffectiveChannels(base())
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('rejects a channel that is not registered', async () => {
    expect(await shouldDeliver(base({ channel: 'sms' }))).toBe(false)
  })

  it('honors per-type eligibility (type.channels restricts the eligible set)', async () => {
    const type = def('marketing.promo', { channels: ['push'] })
    const channels = await resolveEffectiveChannels(base({ typeId: type.type, type }))
    expect(channels).toEqual(['push'])
  })

  it('honors per-send targeting, intersected within eligibility', async () => {
    const channels = await resolveEffectiveChannels(base({ targetChannels: ['push'] }))
    expect(channels).toEqual(['push'])
  })

  it('intersects per-send target with per-type eligibility', async () => {
    const type = def('marketing.promo', { channels: ['push', 'email'] })
    // target asks for in_app+push, eligibility allows push+email → only push survives
    const channels = await resolveEffectiveChannels(
      base({ typeId: type.type, type, targetChannels: ['in_app', 'push'] }),
    )
    expect(channels).toEqual(['push'])
  })

  it('excludes a channel the recipient has opted out of', async () => {
    const channels = await resolveEffectiveChannels(
      base({ preferences: prefs([['orders.created', 'in_app'], ['orders.created', 'email']]) }),
    )
    expect(channels).toEqual(['push'])
  })

  it('nonOptOut bypasses preferences on every channel', async () => {
    const type = def('security.alert', { nonOptOut: true })
    const channels = await resolveEffectiveChannels(
      base({
        typeId: type.type,
        type,
        preferences: prefs([['security.alert', 'in_app'], ['security.alert', 'push']]),
      }),
    )
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('silent does NOT gate delivery (style only)', async () => {
    const type = def('orders.created', { silent: true })
    const channels = await resolveEffectiveChannels(base({ type }))
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('unknown type (undefined def) still consults preferences by type id', async () => {
    const channels = await resolveEffectiveChannels(
      base({ type: undefined, preferences: prefs([['orders.created', 'email']]) }),
    )
    // no eligibility restriction, no nonOptOut → all channels except the opted-out email
    expect(channels).toEqual(['in_app', 'push'])
  })

  it('warns once when an unregistered type escapes governance to user preferences', async () => {
    jest.resetModules()
    const warn = jest.fn()
    jest.doMock('@open-mercato/shared/lib/logger', () => ({
      createLogger: () => ({ child: () => ({ warn }) }),
    }))
    const { shouldDeliver: gate } = require('../shouldDeliver') as typeof import('../shouldDeliver')
    const params = {
      typeId: 'security.renamed',
      type: undefined,
      scope: SCOPE,
      registeredChannels: REGISTERED,
      preferences: prefs(),
      channel: 'push',
    }
    await gate(params)
    await gate({ ...params, channel: 'in_app' }) // same typeId again → deduped
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toEqual({ typeId: 'security.renamed' })
    jest.dontMock('@open-mercato/shared/lib/logger')
  })

  it('empty per-send target resolves to nothing deliverable', async () => {
    const channels = await resolveEffectiveChannels(base({ targetChannels: [] }))
    expect(channels).toEqual([])
  })
})

describe('operator channel-eligibility override (notification_types.channels)', () => {
  it('resolveEligibleChannels: stored override replaces the code set; both absent \u21d2 null (no restriction)', () => {
    const type = def('orders.created', { channels: ['in_app', 'email'] })
    expect(resolveEligibleChannels(type, null)).toEqual(['in_app', 'email'])
    expect(resolveEligibleChannels(type, ['in_app', 'email', 'push'])).toEqual(['in_app', 'email', 'push'])
    expect(resolveEligibleChannels(undefined, ['in_app'])).toEqual(['in_app'])
    expect(resolveEligibleChannels(def('x'), null)).toBeNull()
  })

  it('a code-declared set without push excludes push completely (no user opt-in possible)', async () => {
    const optedIn: ChannelPreferenceReader = { isChannelEnabled: async () => true }
    const type = def('orders.created', { channels: ['in_app', 'email'] })
    const channels = await resolveEffectiveChannels(base({ type, preferences: optedIn }))
    expect(channels).toEqual(['in_app', 'email'])
  })

  it('a stored override re-enables a channel the code set excluded', async () => {
    const type = def('orders.created', { channels: ['in_app', 'email'] })
    const channels = await resolveEffectiveChannels(
      base({ type, channelsOverride: ['in_app', 'email', 'push'] }),
    )
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('a stored override narrows even a nonOptOut type (runs before the bypass)', async () => {
    const type = def('security.alert', { nonOptOut: true })
    const channels = await resolveEffectiveChannels(
      base({ typeId: type.type, type, channelsOverride: ['email'] }),
    )
    expect(channels).toEqual(['email'])
  })

  it('an explicit user opt-in cannot beat the override (channel outside the set stays off)', async () => {
    const optedIn: ChannelPreferenceReader = { isChannelEnabled: async () => true }
    const channels = await resolveEffectiveChannels(
      base({ preferences: optedIn, channelsOverride: ['in_app'] }),
    )
    expect(channels).toEqual(['in_app'])
  })

  it('user preferences still apply normally to channels inside the effective set', async () => {
    const type = def('orders.created', { channels: ['in_app', 'email'] })
    const channels = await resolveEffectiveChannels(
      base({ type, preferences: prefs([['orders.created', 'email']]) }),
    )
    expect(channels).toEqual(['in_app'])
  })
})

describe('operator nonOptOut override (notification_types.non_opt_out)', () => {
  it('override true forces delivery despite an explicit user opt-out', async () => {
    const channels = await resolveEffectiveChannels(
      base({ preferences: prefs([['orders.created', 'email']]), nonOptOutOverride: true }),
    )
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('override false makes a code-required type respect user opt-outs again', async () => {
    const type = def('security.alert', { nonOptOut: true })
    const channels = await resolveEffectiveChannels(
      base({
        typeId: type.type,
        type,
        preferences: prefs([['security.alert', 'push']]),
        nonOptOutOverride: false,
      }),
    )
    expect(channels).toEqual(['in_app', 'email'])
  })

  it('no override inherits the code-declared flag', async () => {
    const type = def('security.alert', { nonOptOut: true })
    const channels = await resolveEffectiveChannels(
      base({ typeId: type.type, type, preferences: prefs([['security.alert', 'push']]), nonOptOutOverride: null }),
    )
    expect(channels).toEqual(['in_app', 'email', 'push'])
  })

  it('the eligibility check still wins over a forced nonOptOut', async () => {
    const channels = await resolveEffectiveChannels(
      base({ nonOptOutOverride: true, channelsOverride: ['in_app'] }),
    )
    expect(channels).toEqual(['in_app'])
  })
})
