import { applyTypeOverride, resolveEffectiveChannels } from '../typeCatalogue'
import { computeChannelsPatch } from '../typeChannelSettings'

jest.mock('../notification-type-registry', () => ({
  getNotificationType: jest.fn(),
  syncNotificationTypes: jest.fn(),
}))

const { getNotificationType } = jest.requireMock('../notification-type-registry') as {
  getNotificationType: jest.Mock
}

const TENANT = '00000000-0000-0000-0000-000000000001'
const REGISTERED = ['in_app', 'email', 'push']

function makeEm() {
  const removed: unknown[] = []
  const persisted: unknown[] = []
  const em = {
    remove: (entity: unknown) => {
      removed.push(entity)
    },
    persist: (entity: unknown) => {
      persisted.push(entity)
    },
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
  }
  return { em: em as never, removed, persisted }
}

beforeEach(() => {
  getNotificationType.mockReset()
})

describe('resolveEffectiveChannels', () => {
  it('prefers the tenant-stored override over the code declaration', () => {
    getNotificationType.mockReturnValue({ channels: ['in_app'] })
    expect(resolveEffectiveChannels('demo.type', ['email'], REGISTERED)).toEqual(['email'])
  })

  it('falls back to the code-declared set when the tenant stores no override', () => {
    getNotificationType.mockReturnValue({ channels: ['in_app', 'email'] })
    expect(resolveEffectiveChannels('demo.type', null, REGISTERED)).toEqual(['in_app', 'email'])
  })

  it('falls back to every registered channel when the type declares none', () => {
    // `channels: undefined` in code means "no restriction", which a per-channel toggle has to
    // materialize before it can remove a single entry from it.
    getNotificationType.mockReturnValue({ channels: undefined })
    expect(resolveEffectiveChannels('demo.type', null, REGISTERED)).toEqual(REGISTERED)
  })

  it('falls back to every registered channel for an unregistered type id', () => {
    getNotificationType.mockReturnValue(undefined)
    expect(resolveEffectiveChannels('demo.type', undefined, REGISTERED)).toEqual(REGISTERED)
  })
})

describe('applyTypeOverride', () => {
  it('creates the row when the tenant stores no override yet', () => {
    const { em, persisted } = makeEm()
    const result = applyTypeOverride(em, {
      tenantId: TENANT,
      notificationTypeId: 'demo.type',
      existing: null,
      nextChannels: ['email'],
      nextNonOptOut: null,
    })
    expect(result).toMatchObject({ tenantId: TENANT, notificationTypeId: 'demo.type', channels: ['email'] })
    expect(persisted).toHaveLength(1)
  })

  it('updates the existing row in place', () => {
    const { em, persisted } = makeEm()
    const existing = { channels: ['in_app'], nonOptOut: null } as never
    const result = applyTypeOverride(em, {
      tenantId: TENANT,
      notificationTypeId: 'demo.type',
      existing,
      nextChannels: ['in_app', 'email'],
      nextNonOptOut: true,
    })
    expect(result).toBe(existing)
    expect(existing).toMatchObject({ channels: ['in_app', 'email'], nonOptOut: true })
    expect(persisted).toHaveLength(0)
  })

  it('drops the row instead of keeping an all-null husk', () => {
    const { em, removed } = makeEm()
    const existing = { channels: ['in_app'], nonOptOut: null } as never
    const result = applyTypeOverride(em, {
      tenantId: TENANT,
      notificationTypeId: 'demo.type',
      existing,
      nextChannels: null,
      nextNonOptOut: null,
    })
    expect(result).toBeNull()
    expect(removed).toEqual([existing])
  })
})

describe('per-channel toggle resolves against current stored state (regression: PR #4326 QA #16)', () => {
  it('keeps a channel a concurrent operator enabled first', () => {
    // Two admins open the settings grid while the type has NO stored override, so both see the
    // code-declared set and neither holds a version token. Admin A enables `email` first.
    getNotificationType.mockReturnValue({ channels: ['in_app'] })
    const afterOperatorA = computeChannelsPatch(
      resolveEffectiveChannels('demo.type', null, REGISTERED),
      'email',
      true,
    )
    expect(afterOperatorA).toEqual(['in_app', 'email'])

    // Admin B now enables `push`. The server re-reads the STORED set under a row lock rather
    // than trusting a client-computed array, so A's `email` survives. Before this change B sent
    // ['in_app', 'push'] — computed from its stale view — and silently reverted A.
    const afterOperatorB = computeChannelsPatch(
      resolveEffectiveChannels('demo.type', afterOperatorA, REGISTERED),
      'push',
      true,
    )
    expect(afterOperatorB).toEqual(['in_app', 'email', 'push'])
  })

  it('clears the override instead of storing an empty set when the last channel is unchecked', () => {
    getNotificationType.mockReturnValue({ channels: ['in_app'] })
    const next = computeChannelsPatch(resolveEffectiveChannels('demo.type', ['email'], REGISTERED), 'email', false)
    expect(next).toBeNull()
  })

  it('is a no-op when disabling a channel that is not in the effective set', () => {
    getNotificationType.mockReturnValue({ channels: ['in_app', 'email'] })
    const base = resolveEffectiveChannels('demo.type', null, REGISTERED)
    expect(computeChannelsPatch(base, 'push', false)).toEqual(['in_app', 'email'])
  })

  it('is idempotent when enabling an already-enabled channel', () => {
    getNotificationType.mockReturnValue({ channels: ['in_app', 'email'] })
    const base = resolveEffectiveChannels('demo.type', null, REGISTERED)
    expect(computeChannelsPatch(base, 'email', true)).toEqual(['in_app', 'email'])
  })
})
