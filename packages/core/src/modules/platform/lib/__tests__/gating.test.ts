import { isPlatformMapEnabled } from '../gating'

describe('isPlatformMapEnabled', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalFlag = process.env.OM_PLATFORM_MAP_ENABLED

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalFlag === undefined) {
      delete process.env.OM_PLATFORM_MAP_ENABLED
    } else {
      process.env.OM_PLATFORM_MAP_ENABLED = originalFlag
    }
  })

  it('allows access in non-production environments', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.OM_PLATFORM_MAP_ENABLED
    expect(isPlatformMapEnabled()).toBe(true)
  })

  it('blocks production unless OM_PLATFORM_MAP_ENABLED is true', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.OM_PLATFORM_MAP_ENABLED
    expect(isPlatformMapEnabled()).toBe(false)

    process.env.OM_PLATFORM_MAP_ENABLED = 'true'
    expect(isPlatformMapEnabled()).toBe(true)
  })
})
