/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as salesFeatures } from '../acl'
import { setup } from '../setup'
import { features as customersFeatures } from '../../customers/acl'
import { features as catalogFeatures } from '../../catalog/acl'
import { features as currenciesFeatures } from '../../currencies/acl'
import { features as shippingCarriersFeatures } from '../../shipping_carriers/acl'
import { features as paymentGatewaysFeatures } from '../../payment_gateways/acl'

// The sales dependency table (spec §6.2) references features from sibling
// modules, so the catalog the resolver checks against must include them.
const combinedCatalog: FeatureDescriptor[] = [
  ...(salesFeatures as FeatureDescriptor[]),
  ...(customersFeatures as FeatureDescriptor[]),
  ...(catalogFeatures as FeatureDescriptor[]),
  ...(currenciesFeatures as FeatureDescriptor[]),
  ...(shippingCarriersFeatures as FeatureDescriptor[]),
  ...(paymentGatewaysFeatures as FeatureDescriptor[]),
]

const salesFeatureIds = (salesFeatures as FeatureDescriptor[]).map((f) => f.id)

describe('sales ACL dependency declarations', () => {
  test('introduces the split view-grained features', () => {
    expect(salesFeatureIds).toContain('sales.channels.view')
    expect(salesFeatureIds).toContain('sales.settings.view')
  })

  test('every sales dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const salesUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('sales.'),
    )
    expect(salesUnknown).toEqual([])
  })

  test('granting sales.orders.view alone surfaces the missing read dependencies (the #2073 toast-storm)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['sales.orders.view'], combinedCatalog)
    const ordersEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'sales.orders.view',
    )
    expect(ordersEntry).toBeDefined()
    expect([...(ordersEntry?.missing ?? [])].sort()).toEqual(
      [
        'catalog.products.view',
        'currencies.view',
        'customers.people.view',
        'sales.channels.view',
        'sales.settings.view',
      ].sort(),
    )
  })

  test('manage features depend on their split view feature', () => {
    const channelsManage = (salesFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'sales.channels.manage',
    )
    const settingsManage = (salesFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'sales.settings.manage',
    )
    expect(channelsManage?.dependsOn).toContain('sales.channels.view')
    expect(settingsManage?.dependsOn).toContain('sales.settings.view')
  })

  test('default role features cover the new view-grained features', () => {
    const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]
    const employeeFeatures = (setup.defaultRoleFeatures?.employee ?? []) as string[]

    // admin keeps the sales.* wildcard, which already covers the new view features
    expect(hasFeature(adminFeatures, 'sales.channels.view')).toBe(true)
    expect(hasFeature(adminFeatures, 'sales.settings.view')).toBe(true)

    // employee is an explicit allowlist and must list the new features so the
    // orders/quotes pages stop 403ing on channel/settings reads
    expect(employeeFeatures).toContain('sales.channels.view')
    expect(employeeFeatures).toContain('sales.channels.manage')
    expect(employeeFeatures).toContain('sales.settings.view')
    expect(employeeFeatures).toContain('sales.settings.manage')
  })
})
