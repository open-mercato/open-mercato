import {
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '@open-mercato/shared/security/aclDependencies'
import { features } from '../modules/onboarding/acl'

describe('onboarding ACL features', () => {
  it('exports an array of feature definitions', () => {
    expect(Array.isArray(features)).toBe(true)
    expect(features.length).toBeGreaterThan(0)
  })

  it('contains exactly three features', () => {
    expect(features).toHaveLength(3)
  })

  it('every feature has a non-empty id, title, and module', () => {
    for (const feature of features) {
      expect(typeof feature.id).toBe('string')
      expect(feature.id.length).toBeGreaterThan(0)
      expect(typeof feature.title).toBe('string')
      expect(feature.title.length).toBeGreaterThan(0)
      expect(typeof feature.module).toBe('string')
      expect(feature.module.length).toBeGreaterThan(0)
    }
  })

  it('all features belong to the onboarding module', () => {
    for (const feature of features) {
      expect(feature.module).toBe('onboarding')
    }
  })

  it('all feature ids follow the onboarding.<action> convention', () => {
    for (const feature of features) {
      expect(feature.id).toMatch(/^onboarding\.\w+$/)
    }
  })

  it('has unique feature ids', () => {
    const ids = features.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes access, submit, and verify features', () => {
    const ids = features.map((feature) => feature.id)
    expect(ids).toContain('onboarding.access')
    expect(ids).toContain('onboarding.submit')
    expect(ids).toContain('onboarding.verify')
  })

  it('is the default export', async () => {
    const mod = await import('../modules/onboarding/acl')
    expect(mod.default).toBe(features)
  })
})

describe('onboarding acl dependency declarations', () => {
  const descriptors: FeatureDescriptor[] = features
  const ownIds = descriptors.map((feature) => feature.id)

  it('declares dependsOn only against features registered in the catalog', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ownIds, descriptors)
    const ownUnknown = diagnostics.unknownReferences.filter((ref) =>
      ref.feature.startsWith('onboarding.'),
    )
    expect(ownUnknown).toEqual([])
  })

  it('resolves cleanly with no missing deps when every feature is granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(ownIds, descriptors)
    const ownMissing = diagnostics.missingDependencies.filter((dep) =>
      dep.feature.startsWith('onboarding.'),
    )
    expect(ownMissing).toEqual([])
  })

  it('keeps every dependency target within the onboarding feature set', () => {
    const ids = new Set(ownIds)
    const deps = descriptors.flatMap((feature) => feature.dependsOn ?? [])
    for (const dep of deps) {
      expect(ids.has(dep)).toBe(true)
    }
  })

  it('flags submit and verify as missing onboarding.access when access is not granted', () => {
    const diagnostics = resolveAclDependencyDiagnostics(
      ['onboarding.submit', 'onboarding.verify'],
      descriptors,
    )
    expect(diagnostics.unknownReferences).toEqual([])
    const submitMissing = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'onboarding.submit',
    )
    const verifyMissing = diagnostics.missingDependencies.find(
      (dep) => dep.feature === 'onboarding.verify',
    )
    expect(submitMissing?.missing).toEqual(['onboarding.access'])
    expect(verifyMissing?.missing).toEqual(['onboarding.access'])
  })
})
