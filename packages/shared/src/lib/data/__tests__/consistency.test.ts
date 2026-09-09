import {
  __resetAlwaysConsistentCacheForTests,
  isReadProjectionAlwaysConsistent,
  parseAlwaysConsistentEnv,
} from '../consistency'

describe('read projection consistency flag', () => {
  const originalEnv = process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT
    } else {
      process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = originalEnv
    }
    __resetAlwaysConsistentCacheForTests()
  })

  it.each([undefined, null, '', ' ', 'off', 'false', '0', 'no', 'disabled', 'none', 'unexpected'])(
    'parses %p as OFF',
    (raw) => {
      expect(parseAlwaysConsistentEnv(raw)).toBe(false)
    },
  )

  it.each(['on', 'true', '1', 'yes', 'enabled'])('parses %p as ON', (raw) => {
    expect(parseAlwaysConsistentEnv(raw)).toBe(true)
  })

  it('memoizes the env value until reset for tests', () => {
    process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = 'on'
    expect(isReadProjectionAlwaysConsistent()).toBe(true)
    process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT = 'off'
    expect(isReadProjectionAlwaysConsistent()).toBe(true)
    __resetAlwaysConsistentCacheForTests()
    expect(isReadProjectionAlwaysConsistent()).toBe(false)
  })
})
