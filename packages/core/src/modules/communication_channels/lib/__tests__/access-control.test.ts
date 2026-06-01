import {
  ADMIN_FEATURE,
  assertCanAccessChannel,
  assertCanManageChannel,
  buildPerUserChannelFilter,
  callerHasChannelAdmin,
  ChannelAccessDeniedError,
} from '../access-control'

describe('callerHasChannelAdmin', () => {
  it('returns true for explicit admin grant', () => {
    expect(callerHasChannelAdmin([ADMIN_FEATURE])).toBe(true)
  })

  it('returns true for module wildcard grant', () => {
    expect(callerHasChannelAdmin(['communication_channels.*'])).toBe(true)
  })

  it('returns true for global wildcard grant', () => {
    expect(callerHasChannelAdmin(['*'])).toBe(true)
  })

  it('returns false when feature is absent', () => {
    expect(callerHasChannelAdmin(['communication_channels.view'])).toBe(false)
  })

  it('returns false for null / undefined / empty', () => {
    expect(callerHasChannelAdmin(null)).toBe(false)
    expect(callerHasChannelAdmin(undefined)).toBe(false)
    expect(callerHasChannelAdmin([])).toBe(false)
  })
})

describe('buildPerUserChannelFilter', () => {
  it('returns undefined for admin callers (no SQL filter required)', () => {
    expect(buildPerUserChannelFilter('user-1', [ADMIN_FEATURE])).toBeUndefined()
  })

  it('returns owned-OR-tenantwide filter for ordinary callers', () => {
    const filter = buildPerUserChannelFilter('user-1', ['communication_channels.view'])
    // MikroORM filters use entity property names (camelCase) — snake_case keys
    // are silently ignored. Keep this expectation aligned with the production
    // shape so the access-control filter actually reaches the SQL layer.
    expect(filter).toEqual({
      $or: [{ userId: 'user-1' }, { userId: null }],
    })
  })

  it('restricts to tenant-wide channels when no current user context exists', () => {
    const filter = buildPerUserChannelFilter(null, [])
    expect(filter).toEqual({ $or: [{ userId: null }] })
  })
})

describe('assertCanAccessChannel', () => {
  it('throws on a null channel', () => {
    expect(() => assertCanAccessChannel(null, 'user-1', [])).toThrow(/Channel not found/)
  })

  it('throws for an admin acting on another user\'s personal mailbox (v1: no bypass)', () => {
    // Personal mailbox privacy v1 — admin grants no longer bypass per-user
    // channel ownership; only the owner may act on their mailbox.
    try {
      assertCanAccessChannel({ userId: 'other-user' }, 'user-1', [ADMIN_FEATURE])
      fail('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ChannelAccessDeniedError)
      expect((err as ChannelAccessDeniedError).statusCode).toBe(403)
    }
  })

  it('returns silently for tenant-wide channels (userId = null)', () => {
    expect(() => assertCanAccessChannel({ userId: null }, 'user-1', [])).not.toThrow()
  })

  it('returns silently for the channel owner', () => {
    expect(() =>
      assertCanAccessChannel({ userId: 'user-1' }, 'user-1', ['communication_channels.view']),
    ).not.toThrow()
  })

  it('throws ChannelAccessDeniedError when another user owns the channel', () => {
    try {
      assertCanAccessChannel({ userId: 'other-user' }, 'user-1', [
        'communication_channels.view',
      ])
      fail('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ChannelAccessDeniedError)
      expect((err as ChannelAccessDeniedError).statusCode).toBe(403)
    }
  })
})

describe('assertCanManageChannel (owner self-service + tenant-wide elevation)', () => {
  const MANAGE = 'communication_channels.manage'
  const CONNECT = 'communication_channels.connect_user_channel'

  it('throws on a null channel', () => {
    expect(() => assertCanManageChannel(null, 'user-1', [], MANAGE)).toThrow(/Channel not found/)
  })

  it('lets the owner manage their OWN personal channel with no management feature', () => {
    // Full control over your own account via connect_user_channel (the route gate).
    expect(() => assertCanManageChannel({ userId: 'user-1' }, 'user-1', [CONNECT], MANAGE)).not.toThrow()
  })

  it('throws for any non-owner on a personal channel — even admin/wildcard (v1: no bypass)', () => {
    for (const features of [[ADMIN_FEATURE], ['communication_channels.*'], ['*'], [MANAGE]]) {
      expect(() => assertCanManageChannel({ userId: 'owner' }, 'user-1', features, MANAGE)).toThrow(
        ChannelAccessDeniedError,
      )
    }
  })

  it('allows a tenant-wide channel only with the elevated feature (incl. wildcards)', () => {
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', [MANAGE], MANAGE)).not.toThrow()
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', ['communication_channels.*'], MANAGE)).not.toThrow()
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', ['*'], MANAGE)).not.toThrow()
  })

  it('throws for a tenant-wide channel when the caller only has connect_user_channel', () => {
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', [CONNECT], MANAGE)).toThrow(
      ChannelAccessDeniedError,
    )
  })

  it('honours a route-specific elevated feature (e.g. push.manage) for tenant-wide channels', () => {
    const PUSH = 'communication_channels.channel.push.manage'
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', [PUSH], PUSH)).not.toThrow()
    // `manage` is not a substitute for the push feature on a shared channel.
    expect(() => assertCanManageChannel({ userId: null }, 'user-1', [MANAGE], PUSH)).toThrow(
      ChannelAccessDeniedError,
    )
  })
})
