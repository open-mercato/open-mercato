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

import { describe, test, expect } from '@jest/globals'
import {
  buildEntityRecordHref,
  entityTypeQueryValues,
  normalizeEntityType,
  resolveLinkedEntityType,
} from '../work-inbox/entity-links'

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
