/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as gatewayTpayFeatures } from '../acl'
import { features as paymentGatewaysFeatures } from '@open-mercato/core/modules/payment_gateways/acl'

// The gateway_tpay dependency table (spec §6.36) references features from the
// payment_gateways module, so the catalog the resolver checks against must
// include them.
const combinedCatalog: FeatureDescriptor[] = [
  ...(gatewayTpayFeatures as FeatureDescriptor[]),
  ...(paymentGatewaysFeatures as FeatureDescriptor[]),
]

const gatewayTpayFeatureIds = (gatewayTpayFeatures as FeatureDescriptor[]).map((f) => f.id)

describe('gateway_tpay ACL dependency declarations', () => {
  test('every gateway_tpay dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayTpayUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('gateway_tpay.'),
    )
    expect(gatewayTpayUnknown).toEqual([])
  })

  test('view depends on the payment gateways read feature', () => {
    const view = (gatewayTpayFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_tpay.view',
    )
    expect(view?.dependsOn).toEqual(['payment_gateways.view'])
  })

  test('configure depends on the local view feature and the payment gateways manage feature', () => {
    const configure = (gatewayTpayFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_tpay.configure',
    )
    expect([...(configure?.dependsOn ?? [])].sort()).toEqual(
      ['gateway_tpay.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting gateway_tpay.view alone surfaces the missing payment_gateways read dependency', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['gateway_tpay.view'], combinedCatalog)
    const viewEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_tpay.view',
    )
    expect(viewEntry).toBeDefined()
    expect([...(viewEntry?.missing ?? [])]).toEqual(['payment_gateways.view'])
  })

  test('granting gateway_tpay.configure alone surfaces both declared dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['gateway_tpay.configure'],
      combinedCatalog,
    )
    const configureEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_tpay.configure',
    )
    expect(configureEntry).toBeDefined()
    expect([...(configureEntry?.missing ?? [])].sort()).toEqual(
      ['gateway_tpay.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting all referenced features clears gateway_tpay dependency warnings', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayTpayMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('gateway_tpay.'),
    )
    expect(gatewayTpayMissing).toEqual([])
  })
})
