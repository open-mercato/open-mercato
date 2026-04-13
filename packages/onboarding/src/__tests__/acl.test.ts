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
