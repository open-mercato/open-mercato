import {
  ADMIN_FEATURE,
  assertCanAccessChannel,
  assertCanManageChannel,
  channelOrgScopeWhere,
  ChannelAccessDeniedError,
} from '../access-control'

describe('channelOrgScopeWhere', () => {
  // Tenant-scoped push channels (FCM/APNs/Expo) are stored with
  // `organization_id IS NULL` deliberately. A read scoped to a non-null
  // selected org must ALSO match those NULL rows, otherwise a channel
  // connected while an admin had a non-null org is invisible to every
  // listing/detail/health/test-send query.
  it('matches both the selected org and tenant-wide (null) rows for a non-null org', () => {
    const orgId = '22222222-2222-4222-8222-222222222222'
    expect(channelOrgScopeWhere(orgId)).toEqual({
      $or: [{ organizationId: orgId }, { organizationId: null }],
    })
  })

  it('narrows to tenant-wide (null) rows only when the caller has no selected org', () => {
    expect(channelOrgScopeWhere(null)).toEqual({ organizationId: null })
  })

  it('treats undefined org the same as null (tenant-wide only)', () => {
    expect(channelOrgScopeWhere(undefined)).toEqual({ organizationId: null })
  })

  it('treats an empty-string org as tenant-wide only (falsy)', () => {
    expect(channelOrgScopeWhere('')).toEqual({ organizationId: null })
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
