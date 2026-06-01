/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features as currenciesFeatures } from '../acl'

// All currencies dependencies are intra-module (spec §6.40), so the resolver
// catalog is just the module's own feature set.
const currenciesCatalog: FeatureDescriptor[] = currenciesFeatures as FeatureDescriptor[]
const currenciesFeatureIds = currenciesCatalog.map((feature) => feature.id)

describe('currencies ACL dependency declarations', () => {
  test('every dependency resolves to a currencies feature (no unknown references)', () => {
    const diagnostics = resolveAclDependencyDiagnostics(currenciesFeatureIds, currenciesCatalog)
    const ownUnknown = diagnostics.unknownReferences.filter((entry) =>
      entry.feature.startsWith('currencies.'),
    )
    expect(ownUnknown).toEqual([])
  })

  test('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(currenciesFeatureIds, currenciesCatalog)
    const ownMissing = diagnostics.missingDependencies.filter((entry) =>
      entry.feature.startsWith('currencies.'),
    )
    expect(ownMissing).toEqual([])
  })

  test('declares the dependency table from spec §6.40', () => {
    const dependsOnById = new Map(
      currenciesCatalog.map((feature) => [feature.id, [...(feature.dependsOn ?? [])].sort()]),
    )
    expect(dependsOnById.get('currencies.view')).toEqual([])
    expect(dependsOnById.get('currencies.manage')).toEqual(['currencies.view'])
    expect(dependsOnById.get('currencies.rates.view')).toEqual(['currencies.view'])
    expect(dependsOnById.get('currencies.rates.manage')).toEqual(['currencies.rates.view'])
    expect(dependsOnById.get('currencies.fetch.view')).toEqual(['currencies.view'])
    expect(dependsOnById.get('currencies.fetch.manage')).toEqual(['currencies.fetch.view'])
  })

  test('granting only a manage feature surfaces its read dependency as missing', () => {
    const diagnostics = resolveAclDependencyDiagnostics(['currencies.rates.manage'], currenciesCatalog)
    expect(diagnostics.unknownReferences).toEqual([])
    const ratesManage = diagnostics.missingDependencies.find(
      (entry) => entry.feature === 'currencies.rates.manage',
    )
    expect(ratesManage?.missing).toEqual(['currencies.rates.view'])
  })

  test('keeps every dependency target within the currencies feature set', () => {
    const ids = new Set(currenciesFeatureIds)
    const deps = currenciesCatalog.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(ids.has(dep)).toBe(true)
    }
  })
})
