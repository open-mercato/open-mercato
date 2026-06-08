/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as checkoutFeatures } from '../acl'
import { features as salesFeatures } from '@open-mercato/core/modules/sales/acl'
import { features as customersFeatures } from '@open-mercato/core/modules/customers/acl'

// The checkout dependency table (spec §6.30) references features from the
// sales and customers modules, so the catalog the resolver checks against must
// include them or those cross-module ids would surface as unknown references.
const combinedCatalog: FeatureDescriptor[] = [
  ...(checkoutFeatures as FeatureDescriptor[]),
  ...(salesFeatures as FeatureDescriptor[]),
  ...(customersFeatures as FeatureDescriptor[]),
]

const checkoutFeatureIds = (checkoutFeatures as FeatureDescriptor[]).map((feature) => feature.id)

describe('checkout ACL dependency declarations', () => {
  test('every checkout dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((feature) => feature.id),
      combinedCatalog,
    )
    const checkoutUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('checkout.'),
    )
    expect(checkoutUnknown).toEqual([])
  })

  test('write features depend on checkout.view', () => {
    const byId = new Map(
      (checkoutFeatures as FeatureDescriptor[]).map((feature) => [feature.id, feature]),
    )
    for (const id of ['checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii', 'checkout.export']) {
      expect(byId.get(id)?.dependsOn).toContain('checkout.view')
    }
  })

  test('granting checkout.create alone surfaces the cross-module read dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['checkout.create'], combinedCatalog)
    const createEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'checkout.create',
    )
    expect(createEntry).toBeDefined()
    expect([...(createEntry?.missing ?? [])].sort()).toEqual(
      ['checkout.view', 'customers.people.view', 'sales.orders.view'].sort(),
    )
  })

  test('checkout.viewPii depends on the customers people read feature', () => {
    const viewPii = (checkoutFeatures as FeatureDescriptor[]).find(
      (feature) => feature.id === 'checkout.viewPii',
    )
    expect(viewPii?.dependsOn).toContain('customers.people.view')
  })
})
