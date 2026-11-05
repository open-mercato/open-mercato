import { metadata } from '../modules/content/index'

describe('content module metadata', () => {
  it('exports a metadata object with required fields', () => {
    expect(metadata).toBeDefined()
    expect(metadata.name).toBe('content')
    expect(metadata.title).toBe('Content')
    expect(typeof metadata.description).toBe('string')
    expect(metadata.description!.length).toBeGreaterThan(0)
  })

  it('uses the correct module name for auto-discovery', () => {
    // Module name must match the directory name for the module system
    expect(metadata.name).toBe('content')
  })

  it('does not declare hard dependencies', () => {
    // Content is a standalone module with no required dependencies
    expect(metadata.requires).toBeUndefined()
  })

  it('is the default export', async () => {
    const mod = await import('../modules/content/index')
    expect(mod.default).toEqual(metadata)
  })
})
