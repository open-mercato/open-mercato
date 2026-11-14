import { GUS_PRODUCTION_URL, GUS_PUBLIC_TEST_KEY, GUS_TEST_URL, resolveGusConfig } from '../lib/config'

describe('resolveGusConfig', () => {
  it('defaults to the test environment with the public GUS test key', () => {
    expect(resolveGusConfig(null)).toEqual({ environment: 'test', baseUrl: GUS_TEST_URL, apiKey: GUS_PUBLIC_TEST_KEY })
    expect(resolveGusConfig({})).toEqual({ environment: 'test', baseUrl: GUS_TEST_URL, apiKey: GUS_PUBLIC_TEST_KEY })
  })

  it('uses a configured key in the test environment', () => {
    expect(resolveGusConfig({ environment: 'test', apiKey: ' own-key ' })).toEqual({
      environment: 'test',
      baseUrl: GUS_TEST_URL,
      apiKey: 'own-key',
    })
  })

  it('requires an API key in production', () => {
    expect(resolveGusConfig({ environment: 'production' })).toBeNull()
    expect(resolveGusConfig({ environment: 'production', apiKey: '   ' })).toBeNull()
  })

  it('never falls back to the public test key in production', () => {
    expect(resolveGusConfig({ environment: 'production', apiKey: 'prod-key' })).toEqual({
      environment: 'production',
      baseUrl: GUS_PRODUCTION_URL,
      apiKey: 'prod-key',
    })
  })

  it('treats unknown environments as test', () => {
    expect(resolveGusConfig({ environment: 'staging' })?.environment).toBe('test')
  })
})
