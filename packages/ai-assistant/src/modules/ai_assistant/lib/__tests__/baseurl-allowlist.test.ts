import { readBaseurlAllowlist, isBaseurlAllowlisted } from '../baseurl-allowlist'

describe('readBaseurlAllowlist', () => {
  it('returns empty array when env var is absent', () => {
    expect(readBaseurlAllowlist({})).toEqual([])
  })

  it('returns empty array when env var is empty string', () => {
    expect(readBaseurlAllowlist({ AI_RUNTIME_BASEURL_ALLOWLIST: '' })).toEqual([])
  })

  it('returns trimmed lowercase entries split by comma', () => {
    expect(
      readBaseurlAllowlist({ AI_RUNTIME_BASEURL_ALLOWLIST: 'openrouter.ai, api.myproxy.io' }),
    ).toEqual(['openrouter.ai', 'api.myproxy.io'])
  })

  it('filters out blank entries from trailing commas', () => {
    expect(
      readBaseurlAllowlist({ AI_RUNTIME_BASEURL_ALLOWLIST: 'openrouter.ai,' }),
    ).toEqual(['openrouter.ai'])
  })

  it('normalises to lowercase', () => {
    expect(
      readBaseurlAllowlist({ AI_RUNTIME_BASEURL_ALLOWLIST: 'OpenRouter.AI' }),
    ).toEqual(['openrouter.ai'])
  })
})

describe('isBaseurlAllowlisted', () => {
  it('returns true for empty baseUrl (no override requested)', () => {
    expect(isBaseurlAllowlisted('', [])).toBe(true)
    expect(isBaseurlAllowlisted('  ', [])).toBe(true)
  })

  it('returns false for non-empty baseUrl when allowlist is empty', () => {
    expect(isBaseurlAllowlisted('https://openrouter.ai/api/v1', [])).toBe(false)
  })

  it('returns true for exact hostname match', () => {
    const allowlist = ['openrouter.ai']
    expect(isBaseurlAllowlisted('https://openrouter.ai/api/v1', allowlist)).toBe(true)
  })

  it('returns false for non-matching hostname', () => {
    const allowlist = ['openrouter.ai']
    expect(isBaseurlAllowlisted('https://evil.example.com/v1', allowlist)).toBe(false)
  })

  it('returns true for wildcard subdomain match', () => {
    const allowlist = ['*.openrouter.ai']
    expect(isBaseurlAllowlisted('https://api.openrouter.ai/v1', allowlist)).toBe(true)
  })

  it('does not match bare domain against wildcard pattern (*.example.com does not match example.com)', () => {
    const allowlist = ['*.openrouter.ai']
    expect(isBaseurlAllowlisted('https://openrouter.ai/v1', allowlist)).toBe(false)
  })

  it('matches the first matching pattern in the list', () => {
    const allowlist = ['api.myproxy.io', 'openrouter.ai']
    expect(isBaseurlAllowlisted('https://openrouter.ai/v1', allowlist)).toBe(true)
  })

  it('returns false when URL does not parse', () => {
    const allowlist = ['openrouter.ai']
    expect(isBaseurlAllowlisted('not-a-url', allowlist)).toBe(false)
  })

  it('is case-insensitive for hostname comparison', () => {
    const allowlist = ['openrouter.ai']
    expect(isBaseurlAllowlisted('https://OPENROUTER.AI/api/v1', allowlist)).toBe(true)
  })
})
