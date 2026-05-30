import { applyEmailVisibilityFilter, callerHasEmailViewPrivate, EMAIL_VIEW_PRIVATE_FEATURE } from '../visibilityFilter'

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

  it('is a no-op when caller has admin bypass', () => {
    const qb = makeFakeBuilder()
    const out = applyEmailVisibilityFilter(qb, {
      currentUserId: 'user-1',
      userFeatures: ['*'],
    })
    expect(out).toBe(qb)
    expect(qb.where).not.toHaveBeenCalled()
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
