/**
 * Authored `entityType` → generated entity id, and the guarantee that the deep
 * link table and the visibility table cannot drift apart.
 *
 * Drift here is silent and dangerous in both directions: a spelling the deep
 * link resolves but the visibility gate does not hides a task from its own
 * assignee, and a spelling the visibility gate resolves but the deep link does
 * not renders a task whose record cannot be opened.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import {
  TASK_ENTITY_TYPE_ALIAS_GROUPS,
  listTaskEntityTypeAliases,
  normalizeTaskEntityTypeSpelling,
} from '../task-entity-aliases'
import { normalizeTaskEntityTypeToEntityId } from '../task-entity-types'
import {
  buildEntityRecordHref,
  resolveLinkedEntityType,
  entityTypeQueryValues,
} from '../work-inbox/entity-links'
import { resolveEntityAclRequirement } from '@open-mercato/core/modules/entities/lib/entityAcl'

const REGISTRY = {
  customers: {
    customer_person_profile: 'customers:customer_person_profile',
    customer_company_profile: 'customers:customer_company_profile',
    customer_deal: 'customers:customer_deal',
    customer_entity: 'customers:customer_entity',
  },
  sales: { sales_order: 'sales:sales_order' },
  catalog: { catalog_product: 'catalog:catalog_product' },
}

describe('normalizeTaskEntityTypeToEntityId', () => {
  beforeEach(() => registerEntityIds(REGISTRY))
  afterEach(() => registerEntityIds(REGISTRY))

  test('resolves the friendly spellings the inspector suggests', () => {
    expect(normalizeTaskEntityTypeToEntityId('customers:person')).toBe(
      'customers:customer_person_profile',
    )
    expect(normalizeTaskEntityTypeToEntityId('customers:deals')).toBe('customers:customer_deal')
    expect(normalizeTaskEntityTypeToEntityId('sales:order')).toBe('sales:sales_order')
  })

  test('accepts the dotted `resourceKind` spelling and stray casing or padding', () => {
    expect(normalizeTaskEntityTypeToEntityId('Customers.Person')).toBe(
      'customers:customer_person_profile',
    )
    expect(normalizeTaskEntityTypeToEntityId('  SALES.ORDERS  ')).toBe('sales:sales_order')
  })

  test('accepts a generated entity id that has no alias entry', () => {
    expect(normalizeTaskEntityTypeToEntityId('catalog:catalog_product')).toBe(
      'catalog:catalog_product',
    )
  })

  test('refuses a typo instead of guessing a nearby id', () => {
    expect(normalizeTaskEntityTypeToEntityId('Custmers:Deal')).toBeNull()
    expect(normalizeTaskEntityTypeToEntityId('customers:dealz')).toBeNull()
    // The pluralize-and-guess fallback `resolveEntityTableName` uses must not
    // leak in here: an unregistered plural is a refusal.
    expect(normalizeTaskEntityTypeToEntityId('catalog:catalog_products')).toBeNull()
  })

  test('refuses empty, blank and non-string bindings', () => {
    expect(normalizeTaskEntityTypeToEntityId('')).toBeNull()
    expect(normalizeTaskEntityTypeToEntityId('   ')).toBeNull()
    expect(normalizeTaskEntityTypeToEntityId(null)).toBeNull()
    expect(normalizeTaskEntityTypeToEntityId(undefined)).toBeNull()
  })

  test('refuses the ambiguous `customers:customer_entity`-style binding by omission, not by accident', () => {
    // It IS a registry id, so it resolves to itself — but it is deliberately not
    // aliased to a person or a company, so nothing silently picks one of them.
    expect(normalizeTaskEntityTypeToEntityId('customers:customer_entity')).toBe(
      'customers:customer_entity',
    )
    expect(listTaskEntityTypeAliases().has('customers:customer_entity')).toBe(false)
  })

  test('fails closed when the entity registry is not registered', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { normalizeTaskEntityTypeToEntityId: freshNormalize } = require('../task-entity-types')
      // An alias still resolves — the dictionary is static — but an id that only
      // the registry could vouch for does not.
      expect(freshNormalize('customers:person')).toBe('customers:customer_person_profile')
      expect(freshNormalize('catalog:catalog_product')).toBeNull()
    })
  })
})

describe('the alias dictionary and the deep link table cannot drift', () => {
  beforeEach(() => registerEntityIds(REGISTRY))

  test('every enumerated spelling normalizes to the id its own group declares', () => {
    for (const group of TASK_ENTITY_TYPE_ALIAS_GROUPS) {
      for (const spelling of group.spellings) {
        expect(normalizeTaskEntityTypeToEntityId(spelling)).toBe(group.entityId)
      }
    }
  })

  test('every spelling is already normalized, so the lookup can never miss it', () => {
    for (const group of TASK_ENTITY_TYPE_ALIAS_GROUPS) {
      for (const spelling of group.spellings) {
        expect(normalizeTaskEntityTypeSpelling(spelling)).toBe(spelling)
      }
    }
  })

  test('no spelling is claimed by two groups', () => {
    const spellings = TASK_ENTITY_TYPE_ALIAS_GROUPS.flatMap((group) => [...group.spellings])
    expect(new Set(spellings).size).toBe(spellings.length)
  })

  test('every linkable spelling resolves to the same record type the deep link picks', () => {
    for (const group of TASK_ENTITY_TYPE_ALIAS_GROUPS) {
      const targets = group.spellings.map((spelling) => resolveLinkedEntityType(spelling))
      const distinct = new Set(targets)
      // A group is either linkable as a whole or not linkable at all — never a
      // mixture, and never split across two detail pages.
      expect(distinct.size).toBe(1)
    }
  })

  test('a spelling the visibility gate accepts also produces a deep link for the four linked types', () => {
    const linkable = ['customers:person', 'customers:companies', 'customers:customer_deal', 'sales:document']
    for (const spelling of linkable) {
      expect(normalizeTaskEntityTypeToEntityId(spelling)).not.toBeNull()
      expect(buildEntityRecordHref(spelling, 'rec-1')).not.toBeNull()
    }
  })

  test('entityTypeQueryValues still expands every spelling of a record type', () => {
    const values = entityTypeQueryValues('customers:person')
    for (const spelling of ['customers:person', 'customers:people', 'customers:customer_person_profile']) {
      expect(values).toContain(spelling)
      expect(values).toContain(spelling.replace(/:/g, '.'))
    }
  })

  test('every alias target is an entity the ACL requirement table knows', () => {
    // The gate derives required view features from `ENTITY_ACL_REQUIREMENTS`; an
    // alias pointing at an id with no entry would resolve and then deny, which
    // reads as a platform bug rather than a policy decision.
    for (const group of TASK_ENTITY_TYPE_ALIAS_GROUPS) {
      expect(resolveEntityAclRequirement(group.entityId)).not.toBeNull()
    }
  })
})
