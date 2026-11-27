import {
  assertSafeOllamaBaseUrl,
  assertTenantOllamaBaseUrl,
  UnsafeOllamaBaseUrlError,
  getOllamaBaseUrlAllowlist,
  isAllowPrivateOllamaBaseUrlEnabled,
  safeOllamaFetch,
} from '../ollama-url-safety'

const ORIGINAL_ENV = { ...process.env }

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function reasonOf(fn: () => void): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof UnsafeOllamaBaseUrlError) return err.reason
    throw err
  }
  throw new Error('expected UnsafeOllamaBaseUrlError but none was thrown')
}

describe('assertSafeOllamaBaseUrl', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE
    process.env.NODE_ENV = 'development'
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  describe('dev loopback allowance', () => {
    it('accepts http://localhost:11434 in development', () => {
      process.env.NODE_ENV = 'development'
      expect(() => assertSafeOllamaBaseUrl('http://localhost:11434')).not.toThrow()
    })

    it('accepts http://127.0.0.1:11434 in development', () => {
      process.env.NODE_ENV = 'development'
      expect(() => assertSafeOllamaBaseUrl('http://127.0.0.1:11434')).not.toThrow()
    })

    it('accepts http://[::1]:11434 in development', () => {
      process.env.NODE_ENV = 'development'
      expect(() => assertSafeOllamaBaseUrl('http://[::1]:11434')).not.toThrow()
    })

    it('rejects http://localhost:11434 in production', () => {
      process.env.NODE_ENV = 'production'
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://localhost:11434'))).toBe(
        'blocked_hostname',
      )
    })

    it('rejects http://127.0.0.1:11434 in production', () => {
      process.env.NODE_ENV = 'production'
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://127.0.0.1:11434'))).toBe(
        'private_ip_literal',
      )
    })
  })

  describe('private/link-local/reserved IP rejection', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('rejects 169.254.169.254 (cloud metadata)', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://169.254.169.254/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects RFC1918 10/8', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://10.0.0.5/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects RFC1918 172.16/12', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://172.16.0.1/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects RFC1918 192.168/16', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://192.168.1.10/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects IPv6 loopback [::1]', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://[::1]/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects IPv6 link-local fe80::/10', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://[fe80::1]/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects IPv6 ULA fc00::/7', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://[fc00::1]/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects IPv4-mapped loopback ::ffff:127.0.0.1', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://[::ffff:127.0.0.1]/'))).toBe(
        'private_ip_literal',
      )
    })

    it('rejects *.internal hostnames', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://ollama.internal/'))).toBe(
        'blocked_hostname',
      )
    })

    it('rejects *.localhost hostnames', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://service.localhost/'))).toBe(
        'blocked_hostname',
      )
    })
  })

  describe('scheme and credentials rejection', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('rejects userinfo (credentials) in URL', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('https://user:pass@ollama.example.com/'))).toBe(
        'credentials_in_url',
      )
    })

    it('rejects file:// scheme', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('file:///etc/passwd'))).toBe(
        'forbidden_protocol',
      )
    })

    it('rejects gopher:// scheme', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('gopher://example.com/'))).toBe(
        'forbidden_protocol',
      )
    })

    it('rejects malformed URLs', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('not-a-url'))).toBe('invalid_url')
    })

    it('rejects empty strings', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl(''))).toBe('missing_host')
    })

    it('rejects whitespace-only strings', () => {
      expect(reasonOf(() => assertSafeOllamaBaseUrl('   '))).toBe('missing_host')
    })
  })

  describe('allowlist overrides', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('accepts host listed in OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST (host only)', () => {
      process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com'
      expect(() =>
        assertSafeOllamaBaseUrl('http://ollama.internal.example.com:11434/'),
      ).not.toThrow()
    })

    it('accepts host:port match in allowlist', () => {
      process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com:11434'
      expect(() =>
        assertSafeOllamaBaseUrl('http://ollama.internal.example.com:11434/'),
      ).not.toThrow()
    })

    it('does not accept a non-matching host even with allowlist set', () => {
      process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com'
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://10.0.0.5/'))).toBe(
        'private_ip_literal',
      )
    })

    it('OM_SEARCH_OLLAMA_ALLOW_PRIVATE relaxes private-IP check', () => {
      process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
      expect(() => assertSafeOllamaBaseUrl('http://10.0.0.5/')).not.toThrow()
    })

    it('allowlist match still enforces scheme allowlist (forbidden_protocol)', () => {
      process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com'
      expect(
        reasonOf(() => assertSafeOllamaBaseUrl('gopher://ollama.internal.example.com/')),
      ).toBe('forbidden_protocol')
    })

    it('allowlist match still rejects credentials in URL', () => {
      process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com'
      expect(
        reasonOf(() =>
          assertSafeOllamaBaseUrl('http://user:secret@ollama.internal.example.com/'),
        ),
      ).toBe('credentials_in_url')
    })

    it('OM_SEARCH_OLLAMA_ALLOW_PRIVATE still enforces scheme allowlist', () => {
      process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
      expect(reasonOf(() => assertSafeOllamaBaseUrl('file:///etc/passwd'))).toBe(
        'forbidden_protocol',
      )
    })

    it('OM_SEARCH_OLLAMA_ALLOW_PRIVATE still rejects credentials in URL', () => {
      process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
      expect(reasonOf(() => assertSafeOllamaBaseUrl('http://user:pass@10.0.0.5/'))).toBe(
        'credentials_in_url',
      )
    })
  })

  describe('valid public URLs', () => {
    it('accepts a public https host in production', () => {
      process.env.NODE_ENV = 'production'
      expect(() => assertSafeOllamaBaseUrl('https://ollama.example.com/')).not.toThrow()
    })
  })
})

describe('assertTenantOllamaBaseUrl', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', OLLAMA_BASE_URL: 'https://operator.example/ollama' }
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it.each(['ollama.example.com', 'ollama.example.com:11434'])('rejects a plaintext downgrade for allowlist entry %s', (entry) => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = entry
    expect(reasonOf(() => assertTenantOllamaBaseUrl('http://ollama.example.com:11434'))).toBe('operator_not_allowed')
  })

  it('accepts HTTPS for an operator-allowlisted host', () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.example.com:11434'
    expect(() => assertTenantOllamaBaseUrl('https://ollama.example.com:11434')).not.toThrow()
  })

  it.each([' ', 'invalid-url'])('honors the HTTPS allowlist with operator URL %j', (operatorUrl) => {
    process.env.OLLAMA_BASE_URL = operatorUrl
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.example.com:11434'
    expect(() => assertTenantOllamaBaseUrl('https://ollama.example.com:11434')).not.toThrow()
  })

  it('uses the local default when the operator URL is blank', () => {
    process.env.NODE_ENV = 'development'
    process.env.OLLAMA_BASE_URL = ' '
    expect(() => assertTenantOllamaBaseUrl('http://localhost:11434')).not.toThrow()
  })

  it('preserves the exact explicitly configured private HTTP endpoint', () => {
    process.env.OLLAMA_BASE_URL = 'http://10.0.0.7:11434/ollama'
    process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
    expect(() => assertTenantOllamaBaseUrl('http://10.0.0.7:11434/ollama/')).not.toThrow()
  })

  it('does not treat private-network permission as plaintext destination authorization', () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = '10.0.0.7:11434'
    process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
    expect(reasonOf(() => assertTenantOllamaBaseUrl('http://10.0.0.7:11434'))).toBe('operator_not_allowed')
  })
})

describe('safeOllamaFetch', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' }
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('rejects private DNS resolution before opening a connection', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>

    await expect(
      safeOllamaFetch('https://ollama.example.com/api/embed', {}, {
        lookupHost: async () => [{ address: '10.0.0.7', family: 4 }],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects mixed public and private DNS answers', async () => {
    const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>

    await expect(
      safeOllamaFetch('https://ollama.example.com/api/embed', {}, {
        lookupHost: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: 'private_ip_resolved' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('revalidates redirects and rejects a public-to-private hop', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        }),
      ) as jest.MockedFunction<typeof fetch>

    await expect(
      safeOllamaFetch('https://ollama.example.com/api/embed', {}, {
        lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: 'private_ip_literal' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ollama.example.com/api/embed',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it.each([301, 302, 303, 307, 308])('blocks an HTTPS-to-HTTP redirect (%s) before forwarding the request', async (status) => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.example.com:11434'
    const redirectResponse = new Response('redirect', {
      status,
      headers: { location: 'http://ollama.example.com:11434/api/embed' },
    })
    const cancel = jest.spyOn(redirectResponse.body!, 'cancel')
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as jest.MockedFunction<typeof fetch>

    await expect(safeOllamaFetch('https://ollama.example.com:11434/api/embed', {
      method: 'POST',
      body: JSON.stringify({ input: 'fixture embedding text' }),
    }, {
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl,
    })).rejects.toMatchObject({ reason: 'operator_not_allowed' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps HTTPS redirects working without dropping the POST body', async () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.example.com'
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 307,
        headers: { location: 'https://ollama.example.com/api/embed-v2' },
      }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as jest.MockedFunction<typeof fetch>

    await expect(safeOllamaFetch('https://ollama.example.com/api/embed', {
      method: 'POST',
      body: 'fixture embedding text',
    }, {
      lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl,
    })).resolves.toMatchObject({ status: 200 })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenLastCalledWith('https://ollama.example.com/api/embed-v2', expect.objectContaining({
      method: 'POST',
      body: expect.any(ArrayBuffer),
    }))
  })

  it('preserves direct requests to the explicitly configured private HTTP operator endpoint', async () => {
    process.env.OLLAMA_BASE_URL = 'http://10.0.0.7:11434/ollama'
    process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
    expect(() => assertTenantOllamaBaseUrl(process.env.OLLAMA_BASE_URL!)).not.toThrow()
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{}', { status: 200 })) as jest.MockedFunction<typeof fetch>

    await expect(safeOllamaFetch('http://10.0.0.7:11434/ollama/api/embed', {}, {
      lookupHost: async () => [{ address: '10.0.0.7', family: 4 }],
      fetchImpl,
    })).resolves.toMatchObject({ status: 200 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('preserves explicitly allowlisted internal Ollama hosts', async () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'ollama.internal.example.com:11434'
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as jest.MockedFunction<typeof fetch>

    await expect(
      safeOllamaFetch('http://ollama.internal.example.com:11434/api/embed', {}, {
        lookupHost: async () => [{ address: '10.0.0.7', family: 4 }],
        fetchImpl,
      }),
    ).resolves.toMatchObject({ status: 200 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('getOllamaBaseUrlAllowlist', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns empty set when env unset', () => {
    expect(getOllamaBaseUrlAllowlist().size).toBe(0)
  })

  it('parses comma-separated entries and lowercases them', () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'Foo.Example.com, Bar:443 ,  baz '
    const allowlist = getOllamaBaseUrlAllowlist()
    expect(allowlist.has('foo.example.com')).toBe(true)
    expect(allowlist.has('bar:443')).toBe(true)
    expect(allowlist.has('baz')).toBe(true)
    expect(allowlist.size).toBe(3)
  })
})

describe('isAllowPrivateOllamaBaseUrlEnabled', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('defaults to false', () => {
    expect(isAllowPrivateOllamaBaseUrlEnabled()).toBe(false)
  })

  it('parses truthy boolean tokens', () => {
    process.env.OM_SEARCH_OLLAMA_ALLOW_PRIVATE = 'true'
    expect(isAllowPrivateOllamaBaseUrlEnabled()).toBe(true)
  })
})
