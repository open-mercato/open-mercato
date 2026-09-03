/**
 * Route-test doubles for the §6.4 read gate.
 *
 * Every task read now resolves an ACL, a tenant setting and the distinct bound
 * entity types before it queries. These stubs make that explicit in a suite —
 * and countable, which is how the "one ACL load per page, not per row" cost
 * property is asserted rather than assumed.
 */

import { jest } from '@jest/globals'

export type StubbedAcl = {
  isSuperAdmin?: boolean
  features?: string[]
}

export type TaskVisibilityRouteStubs = {
  /** `rbacService` double. `loadAcl.mock.calls.length` is the cost assertion. */
  rbacService: { loadAcl: jest.Mock }
  /** `moduleConfigService` double backing the tenant opt-out. */
  moduleConfigService: { getValue: jest.Mock; setValue: jest.Mock }
  /** `em.getConnection()` double serving the distinct-entity-type enumeration. */
  getConnection: () => { execute: jest.Mock }
  /** The raw enumeration double, for asserting its scoping. */
  execute: jest.Mock
}

export function makeTaskVisibilityRouteStubs(options: {
  acl?: StubbedAcl | null
  /** Distinct authored binding types the tenant's tasks carry. */
  scopedEntityTypes?: string[]
  /** Tenant opt-out; `true` (the new model) unless stated. */
  businessContextEnabled?: boolean
} = {}): TaskVisibilityRouteStubs {
  const acl =
    options.acl === null
      ? null
      : { isSuperAdmin: options.acl?.isSuperAdmin ?? false, features: options.acl?.features ?? [] }

  const execute = jest.fn(async () =>
    (options.scopedEntityTypes ?? []).map((entityType) => ({ entity_type: entityType })),
  )

  return {
    rbacService: { loadAcl: jest.fn(async () => acl) },
    moduleConfigService: {
      getValue: jest.fn(async () => options.businessContextEnabled ?? true),
      setValue: jest.fn(async () => undefined),
    },
    getConnection: () => ({ execute }),
    execute,
  }
}
