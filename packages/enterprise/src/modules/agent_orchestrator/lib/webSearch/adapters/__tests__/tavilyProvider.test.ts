import { isWebSearchProviderError, type WebSearchErrorCode } from '@open-mercato/web-search'
import { createTavilyProvider } from '../tavilyProvider'

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

describe('createTavilyProvider', () => {
  it('rejects an empty API key', () => {
    expect(() => createTavilyProvider({ apiKey: '' })).toThrow()
  })

  it('maps and caps Tavily results, sending the bearer key', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse({
        results: [
          { title: 'A', url: 'https://a.example', content: 'snippet a', score: 0.9 },
          { title: 'B', url: 'https://b.example', content: 'snippet b' },
          { url: 'https://c.example', content: 'snippet c' },
        ],
      }),
    ) as unknown as typeof fetch
    const provider = createTavilyProvider({ apiKey: 'tvly-key', fetchFn })

    const results = await provider.search('deal news', { limit: 2 })

    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'snippet a', score: 0.9 },
      { title: 'B', url: 'https://b.example', snippet: 'snippet b' },
    ])
    const [, init] = (fetchFn as jest.Mock).mock.calls[0]
    expect(init.headers.authorization).toBe('Bearer tvly-key')
    expect(JSON.parse(init.body)).toMatchObject({ query: 'deal news', max_results: 2 })
  })

  it('throws bad_response on a non-200', async () => {
    const fetchFn = (async () => new Response('', { status: 401 })) as unknown as typeof fetch
    await expectCode(createTavilyProvider({ apiKey: 'k', fetchFn }).search('q'), 'bad_response')
  })

  it('throws bad_response on malformed shape', async () => {
    const fetchFn = (async () => jsonResponse({ results: 'nope' })) as unknown as typeof fetch
    await expectCode(createTavilyProvider({ apiKey: 'k', fetchFn }).search('q'), 'bad_response')
  })

  it('maps an AbortError to timeout', async () => {
    const fetchFn = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    await expectCode(createTavilyProvider({ apiKey: 'k', fetchFn }).search('q'), 'timeout')
  })
})
