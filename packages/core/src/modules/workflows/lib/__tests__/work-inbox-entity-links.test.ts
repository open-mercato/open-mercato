/**
 * Deep links from a task's entity bindings to the record they are about.
 *
 * `entityType` is AUTHORED free text — the inspector offers `customers:person`
 * as a placeholder and stores whatever was typed — so the two properties worth
 * pinning are that an enumerated type resolves however it was spelled, and that
 * an unenumerated one resolves to NOTHING. A wrong deep link is worse than a
 * plain label: it sends an operator to another record while claiming to be the
 * one the task is about.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import {
  buildEntityRecordHref,
  entityTypeQueryValues,
  normalizeEntityType,
  resolveEntityRecordHref,
  resolveLinkedEntityType,
  withEntityRecordHrefs,
} from '../work-inbox/entity-links'
import {
  clearTaskEntityRegistrationsForTests,
  registerTaskEntityLinkBuilders,
} from '../task-entity-registry'

describe('entity type normalization', () => {
  test('accepts both platform spellings of the same record type', () => {
    // `module:entity` is the entity-id spelling; `module.entity` is the
    // `resourceKind` spelling record-detail pages publish.
    expect(normalizeEntityType('customers.person')).toBe('customers:person')
    expect(normalizeEntityType(' Customers:Person ')).toBe('customers:person')
  })

  test('resolves known aliases onto one canonical type', () => {
    expect(resolveLinkedEntityType('customers:customer_deal')).toBe('customers:deal')
    expect(resolveLinkedEntityType('sales.sales_order')).toBe('sales:order')
  })

  test('leaves an ambiguous entity id unresolved', () => {
    // `customer_entity` backs both people and companies, so it cannot pick a
    // detail page — refusing beats guessing.
    expect(resolveLinkedEntityType('customers:customer_entity')).toBeNull()
  })
})

describe('record hrefs', () => {
  test('builds the backend detail href for each enumerated type', () => {
    expect(buildEntityRecordHref('customers:person', 'p1')).toBe('/backend/customers/people-v2/p1')
    expect(buildEntityRecordHref('customers.company', 'c1')).toBe('/backend/customers/companies-v2/c1')
    expect(buildEntityRecordHref('customers:deal', 'd1')).toBe('/backend/customers/deals/d1')
    expect(buildEntityRecordHref('sales:order', 'o1')).toBe('/backend/sales/orders/o1')
  })

  test('encodes the id so a binding can never break out of its path', () => {
    expect(buildEntityRecordHref('customers:person', 'a/b?c')).toBe(
      '/backend/customers/people-v2/a%2Fb%3Fc',
    )
  })

  test('degrades to no link for an unknown type or a missing id', () => {
    expect(buildEntityRecordHref('inventory:bin', 'b1')).toBeNull()
    expect(buildEntityRecordHref('customers:person', null)).toBeNull()
    expect(buildEntityRecordHref(null, 'p1')).toBeNull()
  })
})

describe('work-inbox entityType filter values', () => {
  test('covers every spelling of a known type so authored bindings still match', () => {
    const values = entityTypeQueryValues('customers.person')
    expect(values).toEqual(expect.arrayContaining(['customers:person', 'customers.person']))
  })

  test('still forwards an unknown type verbatim rather than dropping the filter', () => {
    expect(entityTypeQueryValues('inventory:bin')).toEqual(
      expect.arrayContaining(['inventory:bin', 'inventory.bin']),
    )
  })
})

describe('server-resolved deep links (registered link builders)', () => {
  beforeEach(() => clearTaskEntityRegistrationsForTests())
  afterEach(() => clearTaskEntityRegistrationsForTests())

  test('links a registered app entity through its builder, however the binding spells it', () => {
    registerTaskEntityLinkBuilders([
      { entityId: 'notary:notary_case', buildHref: (recordId) => `/backend/notary/cases/${encodeURIComponent(recordId)}` },
    ])

    expect(resolveEntityRecordHref('notary:notary_case', 'case-1')).toBe('/backend/notary/cases/case-1')
    expect(resolveEntityRecordHref('Notary.Notary_Case', 'a/b')).toBe('/backend/notary/cases/a%2Fb')
  })

  test('an unregistered type still has no link', () => {
    expect(resolveEntityRecordHref('notary:notary_case', 'case-1')).toBeNull()
    expect(buildEntityRecordHref('notary:notary_case', 'case-1')).toBeNull()
  })

  test('the enumerated core links win over a registration for the same type', () => {
    registerTaskEntityLinkBuilders([
      { entityId: 'customers:customer_person_profile', buildHref: () => '/backend/elsewhere' },
    ])

    expect(resolveEntityRecordHref('customers:person', 'p1')).toBe('/backend/customers/people-v2/p1')
  })

  test('refuses anything but a same-origin path, and survives a throwing builder', () => {
    const cases: Array<[string, () => string | null]> = [
      ['notary:offsite', () => 'https://evil.example/x'],
      ['notary:protocol_relative', () => '//evil.example/x'],
      ['notary:backslash', () => '/\\evil.example/x'],
      ['notary:script', () => 'javascript:alert(1)'],
      ['notary:whitespace', () => '/backend/x\ny'],
      ['notary:empty', () => null],
      ['notary:throws', () => {
        throw new Error('boom')
      }],
    ]
    registerTaskEntityLinkBuilders(cases.map(([entityId, buildHref]) => ({ entityId, buildHref })))

    for (const [entityId] of cases) {
      expect(resolveEntityRecordHref(entityId, 'r1')).toBeNull()
    }
  })

  test('adds href to every record-shaped binding and leaves anything else untouched', () => {
    registerTaskEntityLinkBuilders([{ entityId: 'notary:notary_case', buildHref: (id) => `/backend/notary/cases/${id}` }])

    expect(
      withEntityRecordHrefs([
        { entityType: 'notary:notary_case', entityId: 'c1', label: 'Case' },
        { entityType: 'sales:order', entityId: 'o1' },
        { entityType: 'inventory:bin', entityId: 'b1' },
        { entityType: 'notary:notary_case' },
        'nonsense',
      ]),
    ).toEqual([
      { entityType: 'notary:notary_case', entityId: 'c1', label: 'Case', href: '/backend/notary/cases/c1' },
      { entityType: 'sales:order', entityId: 'o1', href: '/backend/sales/orders/o1' },
      { entityType: 'inventory:bin', entityId: 'b1', href: null },
      { entityType: 'notary:notary_case' },
      'nonsense',
    ])
    expect(withEntityRecordHrefs(null)).toBeNull()
  })
})
