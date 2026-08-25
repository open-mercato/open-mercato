import {
  applyEmailVisibilityFilter,
  buildEmailVisibilityMikroFilter,
  callerHasEmailViewPrivate,
  canChangeEmailVisibility,
  EMAIL_VIEW_PRIVATE_FEATURE,
  isEmailHiddenFrom,
  applyEmailHiddenFilter,
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

describe('email visibility fragment contract', () => {
  // Regression guard for the fail-OPEN hazard this module used to invite: the
  // fragment was typed `{ $or?: ... }`, and `personEmailThreads` consumed it as
  // `where.$or = build(...).$or`. Any arm that is not expressible as a member of
  // that single `$or` would have compiled cleanly and been silently discarded,
  // leaking private rows. Two invariants keep that from returning.

  it('is a single-key $or so a whole-fragment spread can never split the predicate', () => {
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: 'user-1',
      userFeatures: undefined,
    })
    // Callers merge this into where-clauses that carry their own keys
    // (`{ entity, deletedAt, ...fragment }`). One key means the merge is total.
    expect(Object.keys(fragment)).toEqual(['$or'])
  })

  it('survives whole-fragment merging in both styles used by the read paths', () => {
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: 'user-1',
      userFeatures: undefined,
    })

    // Style A — object spread (`api/people/[id]`, `api/companies/[id]`).
    const spread = { entity: 'person-1', deletedAt: null, ...fragment }
    expect(spread).toMatchObject({ entity: 'person-1', deletedAt: null })
    expect((spread as Record<string, unknown>).$or).toEqual(
      (fragment as Record<string, unknown>).$or,
    )

    // Style B — Object.assign (`api/activities`, `lib/personEmailThreads`).
    const assigned: Record<string, unknown> = { entity: 'person-1', tenantId: 't1' }
    Object.assign(assigned, fragment)
    expect(assigned.entity).toBe('person-1')
    expect(assigned.tenantId).toBe('t1')
    expect(assigned.$or).toEqual((fragment as Record<string, unknown>).$or)
  })

  it('carries every predicate arm through a merge, not just the first', () => {
    // Proves the merge is lossless over the arm list: an implementation that
    // cherry-picked one arm (or dropped the owner arm) fails here.
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: 'owner-1',
      userFeatures: undefined,
    }) as { $or: unknown[] }
    const merged: Record<string, unknown> = {}
    Object.assign(merged, fragment)
    expect(merged.$or).toHaveLength(4)
    expect(merged.$or).toContainEqual({ authorUserId: 'owner-1' })
  })
})

describe('isEmailHiddenFrom', () => {
  // Row-level complement of applyEmailVisibilityFilter. The card enricher uses
  // it, so a disagreement here means the Reply/Forward actions and the read
  // filter differ about who may act on an email.
  const base = {
    interactionType: 'email',
    visibility: 'private',
    authorUserId: 'owner-1',
    currentUserId: 'other-1',
  }

  it('hides another user\'s private email', () => {
    expect(isEmailHiddenFrom(base)).toBe(true)
  })

  it('shows a private email to its author', () => {
    expect(isEmailHiddenFrom({ ...base, currentUserId: 'owner-1' })).toBe(false)
  })

  it('never hides non-email interactions', () => {
    expect(isEmailHiddenFrom({ ...base, interactionType: 'call' })).toBe(false)
    expect(isEmailHiddenFrom({ ...base, interactionType: 'task' })).toBe(false)
  })

  it('never hides shared or legacy-null rows', () => {
    expect(isEmailHiddenFrom({ ...base, visibility: 'shared' })).toBe(false)
    expect(isEmailHiddenFrom({ ...base, visibility: null })).toBe(false)
  })

  it('hides private email from an anonymous/API-key caller (fail closed)', () => {
    expect(isEmailHiddenFrom({ ...base, currentUserId: null })).toBe(true)
  })

  it('agrees with the MikroORM predicate across a shared row matrix', () => {
    // Both helpers derive from one rule; this matrix is the contract between
    // them. `visible` is what the $or predicate admits, evaluated by hand.
    const rows = [
      { interactionType: 'email', visibility: 'private', authorUserId: 'owner-1', visible: false },
      { interactionType: 'email', visibility: 'private', authorUserId: 'me', visible: true },
      { interactionType: 'email', visibility: 'shared', authorUserId: 'owner-1', visible: true },
      { interactionType: 'email', visibility: null, authorUserId: 'owner-1', visible: true },
      { interactionType: 'call', visibility: 'private', authorUserId: 'owner-1', visible: true },
    ]
    for (const row of rows) {
      expect(
        isEmailHiddenFrom({
          interactionType: row.interactionType,
          visibility: row.visibility,
          authorUserId: row.authorUserId,
          currentUserId: 'me',
        }),
      ).toBe(!row.visible)
    }
  })
})

describe('conversation-share widening', () => {
  // The share arm is what makes a handed-over conversation readable. These tests
  // pin BOTH directions: it admits exactly the granted (person, owner) pairs, and
  // its absence reproduces the strict v1 predicate byte for byte.

  type Expr =
    | { kind: 'cmp'; column: string; op: string; value: unknown }
    | { kind: 'or'; arms: Expr[] }
    | { kind: 'and'; arms: Expr[] }
    | { kind: 'val'; value: unknown }

  function makeBuilder() {
    const predicates: Expr[] = []
    const eb: any = (column: string, op: string, value: unknown): Expr => ({
      kind: 'cmp',
      column,
      op,
      value,
    })
    eb.or = (arms: Expr[]): Expr => ({ kind: 'or', arms })
    eb.and = (arms: Expr[]): Expr => ({ kind: 'and', arms })
    eb.val = (value: unknown): Expr => ({ kind: 'val', value })

    const builder: any = {
      where: jest.fn().mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'function') {
          predicates.push((args[0] as (eb: unknown) => Expr)(eb))
        } else {
          predicates.push({
            kind: 'cmp',
            column: args[0] as string,
            op: args[1] as string,
            value: args[2],
          })
        }
        return builder
      }),
      getPredicates: () => predicates,
    }
    return builder
  }

  const GRANTS = [
    { personEntityId: 'person-1', ownerUserId: 'owner-1' },
    { personEntityId: 'person-2', ownerUserId: 'owner-2' },
  ]

  it('is byte-identical to the strict predicate when no grants are passed', () => {
    const withoutField = buildEmailVisibilityMikroFilter({
      currentUserId: 'me',
      userFeatures: undefined,
    })
    const withEmpty = buildEmailVisibilityMikroFilter({
      currentUserId: 'me',
      userFeatures: undefined,
      sharedConversations: [],
    })
    // Omitting the option and passing an empty list must both fail closed to the
    // v1 behaviour — this is what lets an unconverted read path stay safe.
    expect(withEmpty).toEqual(withoutField)
    expect((withoutField as { $or: unknown[] }).$or).toHaveLength(4)
  })

  it('adds one flat MikroORM arm per grant, keeping the fragment single-key', () => {
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: 'me',
      userFeatures: undefined,
      sharedConversations: GRANTS,
    }) as { $or: unknown[] }

    // Still ONE key, so every spread-style caller merges it losslessly.
    expect(Object.keys(fragment)).toEqual(['$or'])
    expect(fragment.$or).toHaveLength(6)
    expect(fragment.$or).toContainEqual({ entity: 'person-1', authorUserId: 'owner-1' })
    expect(fragment.$or).toContainEqual({ entity: 'person-2', authorUserId: 'owner-2' })
  })

  it('matches on BOTH person and owner, never on either alone', () => {
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: 'me',
      userFeatures: undefined,
      sharedConversations: [GRANTS[0]],
    }) as { $or: Array<Record<string, unknown>> }
    const shareArm = fragment.$or[fragment.$or.length - 1]
    // A grant that matched on person alone would expose every owner's mail for
    // that person; on owner alone, that owner's mail for every person.
    expect(Object.keys(shareArm).sort()).toEqual(['authorUserId', 'entity'])
  })

  it('adds the kysely share arm as an AND of person + owner', () => {
    const qb = makeBuilder()
    applyEmailVisibilityFilter(qb, {
      currentUserId: 'me',
      userFeatures: undefined,
      sharedConversations: [GRANTS[0]],
    })
    const predicate = qb.getPredicates()[0] as Expr
    if (predicate.kind !== 'or') throw new Error('expected OR predicate')
    expect(predicate.arms).toHaveLength(5)
    expect(predicate.arms[4]).toEqual({
      kind: 'and',
      arms: [
        { kind: 'cmp', column: 'entity_id', op: '=', value: 'person-1' },
        { kind: 'cmp', column: 'author_user_id', op: '=', value: 'owner-1' },
      ],
    })
  })

  it('subtracts shared conversations from the hidden-email count', () => {
    const qb = makeBuilder()
    applyEmailHiddenFilter(qb, {
      currentUserId: 'me',
      userFeatures: undefined,
      sharedConversations: [GRANTS[0]],
    })
    const predicates = qb.getPredicates() as Expr[]
    // interaction_type, visibility, author != me, and the NOT-shared clause.
    expect(predicates).toHaveLength(4)
    // "not (person AND owner)" expressed as "person != OR owner !=", so a shared
    // row stops being counted as private the moment the grant exists.
    expect(predicates[3]).toEqual({
      kind: 'and',
      arms: [
        {
          kind: 'or',
          arms: [
            { kind: 'cmp', column: 'entity_id', op: '!=', value: 'person-1' },
            { kind: 'cmp', column: 'author_user_id', op: '!=', value: 'owner-1' },
          ],
        },
      ],
    })
  })

  it('counts everything private when there are no grants', () => {
    const qb = makeBuilder()
    applyEmailHiddenFilter(qb, { currentUserId: 'me', userFeatures: undefined })
    const predicates = qb.getPredicates() as Expr[]
    expect(predicates[3]).toEqual({ kind: 'val', value: true })
  })

  it('unhides a row for the row-level predicate only on an exact grant match', () => {
    const base = {
      interactionType: 'email',
      visibility: 'private',
      authorUserId: 'owner-1',
      currentUserId: 'me',
      sharedConversations: [GRANTS[0]],
    }
    expect(isEmailHiddenFrom({ ...base, personEntityId: 'person-1' })).toBe(false)
    // Right owner, wrong person — still hidden.
    expect(isEmailHiddenFrom({ ...base, personEntityId: 'person-9' })).toBe(true)
    // Right person, wrong owner — still hidden.
    expect(
      isEmailHiddenFrom({ ...base, personEntityId: 'person-1', authorUserId: 'owner-9' }),
    ).toBe(true)
    // No person id resolved off the record — fail closed.
    expect(isEmailHiddenFrom({ ...base, personEntityId: null })).toBe(true)
  })

  it('grants never unlock private email for an anonymous/API-key caller', () => {
    // A null viewer has no author arm and no grants (the service returns [] for
    // an api_key principal), so the widening cannot leak to key-based callers.
    const fragment = buildEmailVisibilityMikroFilter({
      currentUserId: null,
      userFeatures: ['*'],
      sharedConversations: [],
    }) as { $or: unknown[] }
    expect(fragment.$or).toHaveLength(3)
    expect(JSON.stringify(fragment.$or)).not.toContain('authorUserId')
  })
})
