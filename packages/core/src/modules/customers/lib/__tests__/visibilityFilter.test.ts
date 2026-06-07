import {
  applyEmailVisibilityFilter,
  buildEmailVisibilityMikroFilter,
  callerHasEmailViewPrivate,
  canChangeEmailVisibility,
  EMAIL_VIEW_PRIVATE_FEATURE,
} from '../visibilityFilter'

describe('callerHasEmailViewPrivate', () => {
  it('returns true on exact feature match', () => {
    expect(callerHasEmailViewPrivate([EMAIL_VIEW_PRIVATE_FEATURE])).toBe(true)
  })
  it('returns true on customers.* wildcard', () => {
    expect(callerHasEmailViewPrivate(['customers.*'])).toBe(true)
  })
  it('returns true on superadmin *', () => {
    expect(callerHasEmailViewPrivate(['*'])).toBe(true)
  })
  it('returns false on unrelated features', () => {
    expect(callerHasEmailViewPrivate(['customers.people.view', 'customers.deals.view'])).toBe(false)
  })
  it('returns false on empty/null input', () => {
    expect(callerHasEmailViewPrivate([])).toBe(false)
    expect(callerHasEmailViewPrivate(null)).toBe(false)
    expect(callerHasEmailViewPrivate(undefined)).toBe(false)
  })
})

describe('applyEmailVisibilityFilter', () => {
  // The function shape: applyEmailVisibilityFilter(query, options) -> query.
  // It registers a `where(callback)` on a kysely-compatible builder. We feed a
  // fake expression-builder that records every comparison so we can assert the
  // ACTUAL predicate arms, not just that `where` was called.

  type RecordedExpr =
    | { kind: 'cmp'; column: string; op: string; value: unknown }
    | { kind: 'or'; arms: RecordedExpr[] }
    | { kind: 'val'; value: unknown }

  function makeFakeBuilder() {
    let predicate: RecordedExpr | null = null
    const eb: any = (column: string, op: string, value: unknown): RecordedExpr => ({
      kind: 'cmp',
      column,
      op,
      value,
    })
    eb.or = (arms: RecordedExpr[]): RecordedExpr => ({ kind: 'or', arms })
    eb.val = (value: unknown): RecordedExpr => ({ kind: 'val', value })

    const builder: any = {
      where: jest.fn().mockImplementation((cb: (eb: any) => RecordedExpr) => {
        predicate = cb(eb)
        return builder
      }),
      getPredicate: () => predicate,
    }
    return builder
  }

  it('applies the filter even for admin/wildcard features (v1: strict owner-only, no bypass)', () => {
    const qb = makeFakeBuilder()
    const out = applyEmailVisibilityFilter(qb, {
      currentUserId: 'user-1',
      userFeatures: ['*'],
    })
    expect(out).toBe(qb)
    // No admin bypass in v1 — even a superadmin gets the visibility predicate, so
    // they never see another user's private email.
    expect(qb.where).toHaveBeenCalledTimes(1)
    const predicate = qb.getPredicate() as RecordedExpr
    expect(predicate.kind).toBe('or')
  })

  it('builds the four OR arms (non-email, null, !=private, author match) for a normal caller', () => {
    const qb = makeFakeBuilder()
    applyEmailVisibilityFilter(qb, {
      currentUserId: 'user-1',
      userFeatures: ['customers.interactions.view'],
    })
    expect(qb.where).toHaveBeenCalledTimes(1)
    const predicate = qb.getPredicate() as RecordedExpr
    expect(predicate.kind).toBe('or')
    if (predicate.kind !== 'or') throw new Error('expected OR predicate')
    expect(predicate.arms).toEqual([
      { kind: 'cmp', column: 'interaction_type', op: '!=', value: 'email' },
      { kind: 'cmp', column: 'visibility', op: 'is', value: null },
      { kind: 'cmp', column: 'visibility', op: '!=', value: 'private' },
      { kind: 'cmp', column: 'author_user_id', op: '=', value: 'user-1' },
    ])
  })

  it('fails closed (no author arm; uses val(false)) when there is no current user', () => {
    const qb = makeFakeBuilder()
    applyEmailVisibilityFilter(qb, {
      currentUserId: null,
      userFeatures: ['customers.interactions.view'],
    })
    const predicate = qb.getPredicate() as RecordedExpr
    if (predicate.kind !== 'or') throw new Error('expected OR predicate')
    // The author-match arm must NOT reference any user id; anonymous callers can
    // only ever see non-email / null / shared rows — never another user's private email.
    expect(predicate.arms[3]).toEqual({ kind: 'val', value: false })
    expect(JSON.stringify(predicate.arms)).not.toContain('author_user_id')
  })
})

describe('buildEmailVisibilityMikroFilter', () => {
  // MikroORM-flavoured mirror of applyEmailVisibilityFilter used by the
  // person-detail, /activities and /counts read paths. v1 strict owner-only:
  // NO admin bypass — every caller (admins included) gets the same predicate
  // that excludes other users' private emails while passing non-email, shared,
  // and legacy-null rows.
  it('applies the same $or for admins/wildcards (v1: strict owner-only, no bypass)', () => {
    const expected = {
      $or: [
        { interactionType: { $ne: 'email' } },
        { visibility: null },
        { visibility: { $ne: 'private' } },
        { authorUserId: 'user-1' },
      ],
    }
    expect(buildEmailVisibilityMikroFilter({ currentUserId: 'user-1', userFeatures: ['customers.*'] })).toEqual(expected)
    expect(buildEmailVisibilityMikroFilter({ currentUserId: 'user-1', userFeatures: ['*'] })).toEqual(expected)
    expect(buildEmailVisibilityMikroFilter({ currentUserId: 'user-1', userFeatures: [EMAIL_VIEW_PRIVATE_FEATURE] })).toEqual(expected)
  })

  it('builds an $or with the owner arm for a normal caller', () => {
    expect(
      buildEmailVisibilityMikroFilter({ currentUserId: 'user-1', userFeatures: ['customers.people.view'] }),
    ).toEqual({
      $or: [
        { interactionType: { $ne: 'email' } },
        { visibility: null },
        { visibility: { $ne: 'private' } },
        { authorUserId: 'user-1' },
      ],
    })
  })

  it('omits the owner arm when there is no current user (anonymous/API key never sees private email)', () => {
    expect(
      buildEmailVisibilityMikroFilter({ currentUserId: null, userFeatures: ['customers.people.view'] }),
    ).toEqual({
      $or: [
        { interactionType: { $ne: 'email' } },
        { visibility: null },
        { visibility: { $ne: 'private' } },
      ],
    })
  })
})

describe('canChangeEmailVisibility', () => {
  const base = {
    interactionType: 'email',
    currentVisibility: 'private' as string | null,
    nextVisibility: 'shared' as string | null,
    authorUserId: 'author-1' as string | null,
    actorUserId: 'other-2' as string | null,
    userFeatures: ['customers.interactions.manage'] as string[] | null,
  }

  it('always allows changes on non-email interactions', () => {
    expect(canChangeEmailVisibility({ ...base, interactionType: 'call' })).toBe(true)
    expect(canChangeEmailVisibility({ ...base, interactionType: 'task', actorUserId: null, userFeatures: [] })).toBe(true)
  })

  it('allows a no-op (visibility unchanged)', () => {
    expect(canChangeEmailVisibility({ ...base, currentVisibility: 'private', nextVisibility: 'private' })).toBe(true)
    expect(canChangeEmailVisibility({ ...base, currentVisibility: null, nextVisibility: null })).toBe(true)
  })

  it('allows the author to change their own email visibility', () => {
    expect(canChangeEmailVisibility({ ...base, actorUserId: 'author-1', userFeatures: [] })).toBe(true)
  })

  it('DENIES a non-author even with admin/wildcard features (v1: no bypass)', () => {
    // Personal mailbox privacy v1 — only the author may flip their own email's
    // visibility; admin grants no longer bypass this gate.
    expect(canChangeEmailVisibility({ ...base, userFeatures: [EMAIL_VIEW_PRIVATE_FEATURE] })).toBe(false)
    expect(canChangeEmailVisibility({ ...base, userFeatures: ['customers.*'] })).toBe(false)
    expect(canChangeEmailVisibility({ ...base, userFeatures: ['*'] })).toBe(false)
  })

  it('DENIES a non-author without elevated features', () => {
    expect(canChangeEmailVisibility({ ...base })).toBe(false)
  })

  it('DENIES an actor-less caller (API key) without view_private', () => {
    expect(canChangeEmailVisibility({ ...base, actorUserId: null, userFeatures: ['customers.interactions.manage'] })).toBe(false)
    expect(canChangeEmailVisibility({ ...base, actorUserId: null, userFeatures: null })).toBe(false)
  })
})
