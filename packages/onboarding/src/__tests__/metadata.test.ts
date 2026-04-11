import { metadata, features } from '../modules/onboarding/index'

describe('onboarding module metadata', () => {
  it('has the expected module name', () => {
    expect(metadata.name).toBe('onboarding')
  })

  it('has a non-empty title', () => {
    expect(typeof metadata.title).toBe('string')
    expect(metadata.title.length).toBeGreaterThan(0)
  })

  it('has a valid semver version', () => {
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('has a non-empty description', () => {
    expect(typeof metadata.description).toBe('string')
    expect(metadata.description.length).toBeGreaterThan(0)
  })

  it('has a non-empty author', () => {
    expect(typeof metadata.author).toBe('string')
    expect(metadata.author.length).toBeGreaterThan(0)
  })

  it('has a license field', () => {
    expect(typeof metadata.license).toBe('string')
    expect(metadata.license.length).toBeGreaterThan(0)
  })

  it('re-exports features from the module index', () => {
    expect(Array.isArray(features)).toBe(true)
    expect(features.length).toBeGreaterThan(0)
  })
})
