import { readBaseurlAllowlist, isBaseurlAllowlisted, resolveAllowlistedBaseurl } from '../baseurl-allowlist'

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

describe('isBaseurlAllowlisted — scheme and port (issue #7228)', () => {
  describe('host-only entries allow https on the default port only', () => {
    const allowlist = ['api.openai.com', '*.openrouter.ai']

    it.each([
      ['https://api.openai.com/v1'],
      ['https://api.openai.com:443/v1'],
      ['https://API.OpenAI.com/v1'],
      ['https://eu.openrouter.ai/api/v1'],
    ])('accepts %s', (url) => {
      expect(isBaseurlAllowlisted(url, allowlist)).toBe(true)
    })

    it.each([
      ['http://api.openai.com/v1'],
      ['http://api.openai.com:80/v1'],
      ['https://api.openai.com:8443/v1'],
      ['http://api.openai.com:443/v1'],
      ['http://eu.openrouter.ai/api/v1'],
      ['https://eu.openrouter.ai:444/api/v1'],
      ['ws://api.openai.com/v1'],
    ])('rejects %s', (url) => {
      expect(isBaseurlAllowlisted(url, allowlist)).toBe(false)
    })
  })

  describe('full-origin entries match scheme, host and effective port exactly', () => {
    const allowlist = ['http://localhost:11434', 'https://proxy.internal:8443', 'https://*.myproxy.io:9443']

    it.each([
      ['http://localhost:11434/v1'],
      ['https://proxy.internal:8443/v1'],
      ['https://edge.myproxy.io:9443/openai/v1'],
    ])('accepts %s', (url) => {
      expect(isBaseurlAllowlisted(url, allowlist)).toBe(true)
    })

    it.each([
      ['https://localhost:11434/v1'],
      ['http://localhost:11435/v1'],
      ['http://localhost/v1'],
      ['http://proxy.internal:8443/v1'],
      ['https://proxy.internal/v1'],
      ['https://myproxy.io:9443/v1'],
      ['https://edge.myproxy.io/v1'],
    ])('rejects %s', (url) => {
      expect(isBaseurlAllowlisted(url, allowlist)).toBe(false)
    })

    it('an explicit https origin on the default port behaves like the host-only entry', () => {
      expect(isBaseurlAllowlisted('https://api.openai.com/v1', ['https://api.openai.com'])).toBe(true)
      expect(isBaseurlAllowlisted('https://api.openai.com:443/v1', ['https://api.openai.com:443'])).toBe(true)
      expect(isBaseurlAllowlisted('http://api.openai.com/v1', ['https://api.openai.com'])).toBe(false)
    })
  })

  describe('entry and candidate edge cases', () => {
    it('skips a bare wildcard entry instead of matching every trailing-dot host', () => {
      expect(isBaseurlAllowlisted('https://evil.com./v1', ['*.'])).toBe(false)
    })

    it('reads a bare host:port entry as https on that port', () => {
      expect(isBaseurlAllowlisted('https://proxy.internal:8443/v1', ['proxy.internal:8443'])).toBe(true)
      expect(isBaseurlAllowlisted('http://proxy.internal:8443/v1', ['proxy.internal:8443'])).toBe(false)
      expect(isBaseurlAllowlisted('https://proxy.internal/v1', ['proxy.internal:8443'])).toBe(false)
    })

    it('matches an IPv6 loopback origin entry', () => {
      expect(isBaseurlAllowlisted('http://[::1]:11434/v1', ['http://[::1]:11434'])).toBe(true)
      expect(isBaseurlAllowlisted('http://[::1]:11435/v1', ['http://[::1]:11434'])).toBe(false)
    })

    it('matches an internationalised entry against the punycode hostname', () => {
      expect(isBaseurlAllowlisted('https://xn--bcher-kva.example/v1', ['bücher.example'])).toBe(true)
    })

    it.each([
      ['https://api.openai.com./v1'],
      ['https://api.openai.com@evil.example/v1'],
      ['https://api.openai.com.evil.example/v1'],
      ['https://evilapi.openai.com/v1'],
    ])('rejects lookalike candidate %s', (url) => {
      expect(isBaseurlAllowlisted(url, ['api.openai.com'])).toBe(false)
    })
  })

  it('ignores an entry that does not parse instead of widening the list', () => {
    expect(isBaseurlAllowlisted('https://api.openai.com/v1', ['http://'])).toBe(false)
  })

  it('readBaseurlAllowlist keeps origin entries intact (lower-cased)', () => {
    expect(
      readBaseurlAllowlist({ AI_RUNTIME_BASEURL_ALLOWLIST: 'api.openai.com, HTTP://LocalHost:11434' }),
    ).toEqual(['api.openai.com', 'http://localhost:11434'])
  })
})

describe('resolveAllowlistedBaseurl (issue #7228)', () => {
  it('returns null for an empty stored value', () => {
    expect(resolveAllowlistedBaseurl(null, ['api.openai.com'])).toBeNull()
    expect(resolveAllowlistedBaseurl('  ', ['api.openai.com'])).toBeNull()
  })

  it('returns the trimmed value when it is still allowed', () => {
    expect(resolveAllowlistedBaseurl(' https://api.openai.com/v1 ', ['api.openai.com'])).toBe('https://api.openai.com/v1')
  })

  it('returns null when the value is no longer allowed', () => {
    expect(resolveAllowlistedBaseurl('http://api.openai.com/v1', ['api.openai.com'])).toBeNull()
    expect(resolveAllowlistedBaseurl('https://api.openai.com/v1', [])).toBeNull()
  })

  it('reads AI_RUNTIME_BASEURL_ALLOWLIST when no allowlist is passed', () => {
    const original = process.env.AI_RUNTIME_BASEURL_ALLOWLIST
    try {
      process.env.AI_RUNTIME_BASEURL_ALLOWLIST = 'http://localhost:11434'
      expect(resolveAllowlistedBaseurl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
      delete process.env.AI_RUNTIME_BASEURL_ALLOWLIST
      expect(resolveAllowlistedBaseurl('http://localhost:11434/v1')).toBeNull()
    } finally {
      if (original === undefined) delete process.env.AI_RUNTIME_BASEURL_ALLOWLIST
      else process.env.AI_RUNTIME_BASEURL_ALLOWLIST = original
    }
  })
})
