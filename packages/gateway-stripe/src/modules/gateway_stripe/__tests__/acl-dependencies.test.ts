/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as gatewayStripeFeatures } from '../acl'
import { features as paymentGatewaysFeatures } from '@open-mercato/core/modules/payment_gateways/acl'

// The gateway_stripe dependency table (spec §6.36) references features from the
// payment_gateways module, so the catalog the resolver checks against must
// include them.
const combinedCatalog: FeatureDescriptor[] = [
  ...(gatewayStripeFeatures as FeatureDescriptor[]),
  ...(paymentGatewaysFeatures as FeatureDescriptor[]),
]

const gatewayStripeFeatureIds = (gatewayStripeFeatures as FeatureDescriptor[]).map((f) => f.id)

describe('gateway_stripe ACL dependency declarations', () => {
  test('every gateway_stripe dependency resolves to a known feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayStripeUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('gateway_stripe.'),
    )
    expect(gatewayStripeUnknown).toEqual([])
  })

  test('view depends on the payment gateways read feature', () => {
    const view = (gatewayStripeFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_stripe.view',
    )
    expect(view?.dependsOn).toEqual(['payment_gateways.view'])
  })

  test('configure depends on the local view feature and the payment gateways manage feature', () => {
    const configure = (gatewayStripeFeatures as FeatureDescriptor[]).find(
      (f) => f.id === 'gateway_stripe.configure',
    )
    expect([...(configure?.dependsOn ?? [])].sort()).toEqual(
      ['gateway_stripe.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting gateway_stripe.view alone surfaces the missing payment_gateways read dependency', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['gateway_stripe.view'], combinedCatalog)
    const viewEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_stripe.view',
    )
    expect(viewEntry).toBeDefined()
    expect([...(viewEntry?.missing ?? [])]).toEqual(['payment_gateways.view'])
  })

  test('granting gateway_stripe.configure alone surfaces both declared dependencies', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['gateway_stripe.configure'],
      combinedCatalog,
    )
    const configureEntry = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'gateway_stripe.configure',
    )
    expect(configureEntry).toBeDefined()
    expect([...(configureEntry?.missing ?? [])].sort()).toEqual(
      ['gateway_stripe.view', 'payment_gateways.manage'].sort(),
    )
  })

  test('granting all referenced features clears gateway_stripe dependency warnings', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      combinedCatalog.map((f) => f.id),
      combinedCatalog,
    )
    const gatewayStripeMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('gateway_stripe.'),
    )
    expect(gatewayStripeMissing).toEqual([])
  })
})
