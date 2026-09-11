/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as gatewayAutopayFeatures } from '../acl'
import { features as paymentGatewaysFeatures } from '@open-mercato/core/modules/payment_gateways/acl'

const combinedCatalog: FeatureDescriptor[] = [
  ...(gatewayAutopayFeatures as FeatureDescriptor[]),
  ...(paymentGatewaysFeatures as FeatureDescriptor[]),
]

describe('gateway_autopay ACL dependency declarations', () => {
  test('every gateway_autopay dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayAutopayUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('gateway_autopay.'),
    )
    expect(gatewayAutopayUnknown).toEqual([])
  })

  test('view depends on the payment gateways read feature', () => {
    const view = (gatewayAutopayFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_autopay.view',
    )
    expect(view?.dependsOn).toEqual(['payment_gateways.view'])
  })

  test('configure depends on the local view feature and the payment gateways manage feature', () => {
    const configure = (gatewayAutopayFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_autopay.configure',
    )
    expect([...(configure?.dependsOn ?? [])].sort()).toEqual(
      ['gateway_autopay.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting gateway_autopay.view alone surfaces the missing payment_gateways read dependency', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['gateway_autopay.view'], combinedCatalog)
    const viewEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_autopay.view',
    )
    expect(viewEntry).toBeDefined()
    expect([...(viewEntry?.missing ?? [])]).toEqual(['payment_gateways.view'])
  })

  test('granting gateway_autopay.configure alone surfaces both declared dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['gateway_autopay.configure'],
      combinedCatalog,
    )
    const configureEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_autopay.configure',
    )
    expect(configureEntry).toBeDefined()
    expect([...(configureEntry?.missing ?? [])].sort()).toEqual(
      ['gateway_autopay.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting all referenced features clears gateway_autopay dependency warnings', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayAutopayMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('gateway_autopay.'),
    )
    expect(gatewayAutopayMissing).toEqual([])
  })
})
