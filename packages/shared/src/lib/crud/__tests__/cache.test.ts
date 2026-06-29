jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async <T>(_tenant: string | null, fn: () => Promise<T> | T) => fn(),
}))

import { deriveResourceFromCommandId } from '@open-mercato/shared/lib/crud/cache'

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
