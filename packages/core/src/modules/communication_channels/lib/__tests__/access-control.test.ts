import {
  ADMIN_FEATURE,
  assertCanAccessChannel,
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

  it('returns silently for admin callers, regardless of owner', () => {
    expect(() =>
      assertCanAccessChannel({ userId: 'other-user' }, 'user-1', [ADMIN_FEATURE]),
    ).not.toThrow()
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
