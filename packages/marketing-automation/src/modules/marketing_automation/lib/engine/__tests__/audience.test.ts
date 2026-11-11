import {
  AUDIENCE_ERROR_RESULT,
  EMPTY_GROUP_RESULT,
  NO_AUDIENCE_RESULT,
  matchesAudience,
} from '../audience'
import type { SubjectDocument } from '../types'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const now = new Date('2026-09-28T12:00:00.000Z')
const check = (audience: unknown, subject: SubjectDocument) =>
  matchesAudience(audience as never, subject, { now, logger })

const buyer: SubjectDocument = {
  customer: { id: 'c1', email: 'buyer@example.com', displayName: 'Buyer', createdAt: '2026-01-01T00:00:00.000Z' },
  tags: ['newsletter', 'vip'],
  orders: { count: 4, totalGross: 950.5, lastPlacedAt: '2026-09-20T00:00:00.000Z', daysSinceLast: 8 },
  trigger: { orderTotal: 120 },
}

/** Has an account but has never ordered, so the order aggregates carry no magnitudes. */
const newcomer: SubjectDocument = {
  customer: { id: 'c2', email: 'newcomer@example.com', displayName: 'Newcomer', createdAt: '2026-09-27T00:00:00.000Z' },
  tags: [],
  orders: { count: 0, totalGross: 0 },
  trigger: {},
}

beforeEach(() => jest.clearAllMocks())

describe('matchesAudience — basics', () => {
  test('a campaign with no audience applies to everyone', () => {
    expect(check(null, buyer)).toBe(NO_AUDIENCE_RESULT)
    expect(check(undefined, buyer)).toBe(NO_AUDIENCE_RESULT)
  })

  test('compares a scalar the triggering event contributed', () => {
    expect(check({ field: 'trigger.orderTotal', operator: '>=', value: 100 }, buyer)).toBe(true)
    expect(check({ field: 'trigger.orderTotal', operator: '>=', value: 500 }, buyer)).toBe(false)
  })

  test('matches a tag through the list', () => {
    expect(check({ field: 'tags', operator: 'CONTAINS', value: 'vip' }, buyer)).toBe(true)
    expect(check({ field: 'tags', operator: 'CONTAINS', value: 'churned' }, buyer)).toBe(false)
  })

  test('reads order aggregates by path', () => {
    expect(check({ field: 'orders.count', operator: '>=', value: 3 }, buyer)).toBe(true)
    expect(check({ field: 'orders.daysSinceLast', operator: '<=', value: 30 }, buyer)).toBe(true)
  })
})

describe('matchesAudience — boolean combination', () => {
  test('AND requires every rule', () => {
    expect(check({ operator: 'AND', rules: [
      { field: 'orders.count', operator: '>=', value: 2 },
      { field: 'tags', operator: 'CONTAINS', value: 'vip' },
    ] }, buyer)).toBe(true)
    expect(check({ operator: 'AND', rules: [
      { field: 'orders.count', operator: '>=', value: 2 },
      { field: 'tags', operator: 'CONTAINS', value: 'churned' },
    ] }, buyer)).toBe(false)
  })

  test('OR needs one rule', () => {
    expect(check({ operator: 'OR', rules: [
      { field: 'tags', operator: 'CONTAINS', value: 'churned' },
      { field: 'trigger.orderTotal', operator: '>', value: 100 },
    ] }, buyer)).toBe(true)
  })

  test('NOT negates a single rule', () => {
    expect(check({ operator: 'NOT', rules: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] }, buyer)).toBe(false)
    expect(check({ operator: 'NOT', rules: [{ field: 'tags', operator: 'CONTAINS', value: 'churned' }] }, buyer)).toBe(true)
  })

  test('groups nest', () => {
    expect(check({ operator: 'AND', rules: [
      { field: 'orders.count', operator: '>=', value: 1 },
      { operator: 'OR', rules: [
        { field: 'tags', operator: 'CONTAINS', value: 'churned' },
        { operator: 'AND', rules: [
          { field: 'trigger.orderTotal', operator: '>=', value: 100 },
          { field: 'customer.email', operator: 'ENDS_WITH', value: 'example.com' },
        ] },
      ] },
    ] }, buyer)).toBe(true)
  })

  test('an empty group excludes rather than passing vacuously', () => {
    expect(check({ operator: 'AND', rules: [] }, buyer)).toBe(EMPTY_GROUP_RESULT)
    expect(check({ operator: 'OR', rules: [] }, buyer)).toBe(EMPTY_GROUP_RESULT)
  })
})

describe('matchesAudience — missing-operand veto', () => {
  // The platform evaluator sorts a missing left-hand value below every number, so without the
  // veto `daysSinceLast <= 30` would be TRUE for somebody who never ordered and a win-back
  // campaign would mail every never-buyer. These are the regression guards for that.
  test.each([
    ['<=', 30],
    ['<', 30],
  ])('a never-ordered subject fails %s %p', (operator, value) => {
    expect(check({ field: 'orders.daysSinceLast', operator, value }, newcomer)).toBe(false)
  })

  test.each([
    ['>=', 30],
    ['>', 30],
  ])('a never-ordered subject also fails %s %p', (operator, value) => {
    expect(check({ field: 'orders.daysSinceLast', operator, value }, newcomer)).toBe(false)
  })

  test('an explicit null operand is vetoed exactly like an absent one', () => {
    const withNull = { ...newcomer, orders: { count: 0, totalGross: 0, daysSinceLast: null } } as unknown as SubjectDocument
    expect(check({ field: 'orders.daysSinceLast', operator: '<=', value: 30 }, withNull)).toBe(false)
  })

  test('a veto inside an OR does not poison the other branch', () => {
    expect(check({ operator: 'OR', rules: [
      { field: 'orders.daysSinceLast', operator: '<=', value: 30 },
      { field: 'customer.email', operator: 'ENDS_WITH', value: 'example.com' },
    ] }, newcomer)).toBe(true)
  })

  // Equality and emptiness are meaningful questions about a missing value, so they are not
  // vetoed — otherwise "customers with no orders" would become inexpressible.
  test('equality and emptiness operators still see the missing value', () => {
    expect(check({ field: 'orders.daysSinceLast', operator: 'IS_EMPTY', value: null }, newcomer)).toBe(true)
    expect(check({ field: 'orders.count', operator: '=', value: 0 }, newcomer)).toBe(true)
    expect(check({ field: 'tags', operator: 'IS_EMPTY', value: null }, newcomer)).toBe(true)
  })

  test('a present zero is a real value and is not vetoed', () => {
    const zeroed = { ...newcomer, orders: { count: 0, totalGross: 0, daysSinceLast: 0 } }
    expect(check({ field: 'orders.daysSinceLast', operator: '<=', value: 30 }, zeroed)).toBe(true)
  })
})

describe('matchesAudience — failure handling', () => {
  test('excludes the subject and logs when the expression throws', () => {
    const exploding = { operator: 'AND', rules: [{ get field(): never { throw new Error('boom') } }] }
    expect(matchesAudience(exploding as never, buyer, { now, logger, campaignId: 'camp-1' })).toBe(AUDIENCE_ERROR_RESULT)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
