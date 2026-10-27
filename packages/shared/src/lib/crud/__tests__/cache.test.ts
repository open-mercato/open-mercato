jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async <T>(_tenant: string | null, fn: () => Promise<T> | T) => fn(),
}))

import { deriveResourceFromCommandId, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'

describe('deriveResourceFromCommandId — irregular plurals (#2072)', () => {
  it('singularises "people" to "person"', () => {
    // Regression for the resourceKind divergence between hand-written literals
    // ('customers.person') and factory-derived runtime values
    // ('customers.people') — see issue #2072 and PR #2055.
    expect(deriveResourceFromCommandId('customers.people.update')).toBe('customers.person')
    expect(deriveResourceFromCommandId('customers.people.create')).toBe('customers.person')
    expect(deriveResourceFromCommandId('customers.people.delete')).toBe('customers.person')
  })

  it('handles the other known irregular plurals', () => {
    expect(deriveResourceFromCommandId('mod.children.update')).toBe('mod.child')
    expect(deriveResourceFromCommandId('mod.mice.update')).toBe('mod.mouse')
    expect(deriveResourceFromCommandId('mod.men.update')).toBe('mod.man')
    expect(deriveResourceFromCommandId('mod.women.update')).toBe('mod.woman')
    expect(deriveResourceFromCommandId('mod.geese.update')).toBe('mod.goose')
    expect(deriveResourceFromCommandId('mod.feet.update')).toBe('mod.foot')
    expect(deriveResourceFromCommandId('mod.teeth.update')).toBe('mod.tooth')
    expect(deriveResourceFromCommandId('mod.oxen.update')).toBe('mod.ox')
  })

  it('lower-cases the entity segment before matching irregular plurals', () => {
    // Singularizer is case-insensitive (lower-cases input); commandId module
    // segment casing is preserved by the caller as today.
    expect(deriveResourceFromCommandId('customers.People.update')).toBe('customers.person')
  })

  it('still handles each pre-existing regular plural rule', () => {
    // ies → y (companies → company)
    expect(deriveResourceFromCommandId('customers.companies.update')).toBe('customers.company')
    // ses → s (addresses → address)
    expect(deriveResourceFromCommandId('customers.addresses.update')).toBe('customers.address')
    // xes → x (boxes → box)
    expect(deriveResourceFromCommandId('mod.boxes.update')).toBe('mod.box')
    // zes → z (quizzes → quizze — preserved as today; checking the rule still fires)
    expect(deriveResourceFromCommandId('mod.buzzes.update')).toBe('mod.buzz')
    // ches → ch (matches → match)
    expect(deriveResourceFromCommandId('mod.matches.update')).toBe('mod.match')
    // shes → sh (dishes → dish)
    expect(deriveResourceFromCommandId('mod.dishes.update')).toBe('mod.dish')
    // trailing s → drop (orders → order)
    expect(deriveResourceFromCommandId('sales.orders.update')).toBe('sales.order')
    // dashed segments singularise each part (leave-requests → leave-request)
    expect(deriveResourceFromCommandId('staff.leave-requests.update')).toBe('staff.leave-request')
  })

  it('leaves already-singular hand-written commandIds unchanged', () => {
    expect(deriveResourceFromCommandId('mod.person.update')).toBe('mod.person')
    expect(deriveResourceFromCommandId('mod.box.update')).toBe('mod.box')
  })

  it('returns null for malformed inputs', () => {
    expect(deriveResourceFromCommandId(null)).toBeNull()
    expect(deriveResourceFromCommandId(undefined)).toBeNull()
    expect(deriveResourceFromCommandId('')).toBeNull()
    expect(deriveResourceFromCommandId('singletonly')).toBeNull()
  })
})

describe('invalidateCrudCache — tenant-level (org:null) collection flush (#2919)', () => {
  const ORIGINAL_FLAG = process.env.ENABLE_CRUD_API_CACHE

  beforeAll(() => {
    process.env.ENABLE_CRUD_API_CACHE = 'true'
  })

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = ORIGINAL_FLAG
  })

  function makeContainer(deleteByTags: jest.Mock) {
    const cache = { get: jest.fn(), set: jest.fn(), deleteByTags }
    return { resolve: (name: string) => (name === 'cache' ? cache : null) } as never
  }

  it('flushes the org:null collection tag even when the write carries an actor org', async () => {
    // Roles (orgField: null) cache their list under org:null, but the command bus
    // resolves a write's organizationId from the actor's auth context. Without the
    // org:null tag the cache would only expire on TTL — see TC-UNDO-001 / #2919.
    const deleteByTags = jest.fn(async () => 0)
    await invalidateCrudCache(
      makeContainer(deleteByTags),
      'auth.role',
      { id: 'role-1', organizationId: 'org-9', tenantId: 'tenant-1' },
      'tenant-1',
      'test:org-mismatch',
    )

    expect(deleteByTags).toHaveBeenCalledTimes(1)
    const tags = deleteByTags.mock.calls[0][0] as string[]
    expect(tags).toContain('crud:auth.role:tenant:tenant-1:org:null:collection')
    expect(tags).toContain('crud:auth.role:tenant:tenant-1:org:org-9:collection')
    expect(tags).toContain('crud:auth.role:tenant:tenant-1:record:role-1')
  })

  it('still flushes the org:null collection tag for org-agnostic writes', async () => {
    const deleteByTags = jest.fn(async () => 0)
    await invalidateCrudCache(
      makeContainer(deleteByTags),
      'auth.role',
      { id: 'role-2', organizationId: null, tenantId: 'tenant-1' },
      'tenant-1',
      'test:org-null',
    )

    const tags = deleteByTags.mock.calls[0][0] as string[]
    expect(tags).toContain('crud:auth.role:tenant:tenant-1:org:null:collection')
  })
})
