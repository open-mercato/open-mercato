import { SearxngProvider } from '../searxng-provider'
import { isWebSearchProviderError, type WebSearchErrorCode } from '../errors'
import type { LookupFn } from '../ssrf'

const publicLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
const privateLookup: LookupFn = async () => [{ address: '10.0.0.1', family: 4 }]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function expectCode(promise: Promise<unknown>, code: WebSearchErrorCode): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(isWebSearchProviderError(caught)).toBe(true)
  expect(isWebSearchProviderError(caught) && caught.code).toBe(code)
}

describe('SearxngProvider.search', () => {
  it('maps and caps SearXNG results', async () => {
    const fetchFn = jest.fn<Promise<Response>, [string | URL | Request, RequestInit?]>(async () =>
      jsonResponse({
        results: [
          { title: 'A', url: 'https://a.example', content: 'snippet a', score: 1.2 },
          { title: 'B', url: 'https://b.example', content: 'snippet b' },
          { url: 'https://c.example', content: 'snippet c' },
          { title: 'no-url', content: 'skipped' },
        ],
      }),
    ) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })

    const results = await provider.search('deal news', { limit: 2 })

    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'snippet a', score: 1.2 },
      { title: 'B', url: 'https://b.example', snippet: 'snippet b' },
    ])
  })

  it('skips result items without a url and falls back title to url', async () => {
    const fetchFn = (async () =>
      jsonResponse({ results: [{ url: 'https://only-url.example' }, { title: 'x' }] })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    const results = await provider.search('q')
    expect(results).toEqual([{ title: 'https://only-url.example', url: 'https://only-url.example', snippet: '' }])
  })

  it('throws bad_response on non-200', async () => {
    const fetchFn = (async () => new Response('', { status: 502 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.search('q'), 'bad_response')
  })

  it('throws bad_response on non-JSON', async () => {
    const fetchFn = (async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.search('q'), 'bad_response')
  })

  it('throws bad_response on malformed shape', async () => {
    const fetchFn = (async () => jsonResponse({ results: 'nope' })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.search('q'), 'bad_response')
  })

  it('maps an AbortError to a timeout code', async () => {
    const fetchFn = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.search('q'), 'timeout')
  })
})

describe('SearxngProvider.fetch', () => {
  it('returns readable text and title, size-capped', async () => {
    const html = '<html><head><title>Doc</title></head><body><p>Hello</p><p>World</p></body></html>'
    const fetchFn = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn, lookup: publicLookup })

    const result = await provider.fetch('https://example.com/doc')

    expect(result.title).toBe('Doc')
    expect(result.text).toBe('Hello\nWorld')
    expect(result.truncated).toBe(false)
    expect(result.url).toBe('https://example.com/doc')
  })

  it('truncates oversized bodies', async () => {
    const fetchFn = (async () => new Response('HELLO WORLD', { status: 200 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn, lookup: publicLookup })
    const result = await provider.fetch('https://example.com/big', { maxBytes: 5 })
    expect(result.text).toBe('HELLO')
    expect(result.truncated).toBe(true)
  })

  it('blocks literal private targets before any fetch', async () => {
    const fetchFn = jest.fn(async () => new Response('should not run')) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.fetch('http://169.254.169.254/latest/meta-data'), 'ssrf_blocked')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('blocks non-http schemes', async () => {
    const fetchFn = (async () => new Response('x')) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    await expectCode(provider.fetch('file:///etc/passwd'), 'ssrf_blocked')
  })

  it('blocks a host that resolves to a private address', async () => {
    const fetchFn = (async () => new Response('x')) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn, lookup: privateLookup })
    await expectCode(provider.fetch('http://rebind.example.com/'), 'ssrf_blocked')
  })

  it('follows a redirect and re-validates the target', async () => {
    let call = 0
    const fetchFn = (async () => {
      call += 1
      if (call === 1) {
        return new Response('', { status: 302, headers: { location: 'https://example.com/final' } })
      }
      return new Response('<title>Final</title><p>done</p>', { status: 200 })
    }) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn, lookup: publicLookup })

    const result = await provider.fetch('https://example.com/start')
    expect(result.url).toBe('https://example.com/final')
    expect(result.text).toBe('done')
    expect(call).toBe(2)
  })

  it('rejects a redirect that points at a private address', async () => {
    let call = 0
    const lookup: LookupFn = async (hostname) =>
      hostname === 'evil.example.com'
        ? [{ address: '10.0.0.5', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    const fetchFn = (async () => {
      call += 1
      return new Response('', { status: 302, headers: { location: 'http://evil.example.com/' } })
    }) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn, lookup })
    await expectCode(provider.fetch('https://example.com/start'), 'ssrf_blocked')
  })
})

describe('SearxngProvider.healthCheck', () => {
  it('reports ok on a healthy instance', async () => {
    const fetchFn = (async () => new Response('OK', { status: 200 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    expect(await provider.healthCheck()).toEqual({ ok: true })
  })

  it('reports not-ok on a bad status', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    const health = await provider.healthCheck()
    expect(health.ok).toBe(false)
    expect(health.detail).toContain('503')
  })

  it('reports not-ok when the request throws', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const provider = new SearxngProvider({ baseUrl: 'https://searxng.internal', fetchFn })
    const health = await provider.healthCheck()
    expect(health.ok).toBe(false)
  })

  it('rejects an empty baseUrl at construction', () => {
    expect(() => new SearxngProvider({ baseUrl: '' })).toThrow()
  })
})
