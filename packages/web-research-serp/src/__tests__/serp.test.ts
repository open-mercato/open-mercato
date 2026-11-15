import { createStubHttpClient, createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { createSerpAdapter, serpAdapterModule } from '../adapter'
import { extractSerpResults } from '../extract'
import { SERP_PROFILES } from '../profiles'

const DDG_HTML = `
<!DOCTYPE html>
<html><body>
  <div class="results">
    <div class="result results_links">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=x">First &amp; best</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">Snippet <b>one</b> here.</a>
    </div>
    <div class="result results_links">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://other.org/two">Second result</a>
      </h2>
      <div class='result__snippet'>Snippet two.</div>
    </div>
    <div class="result results_links result--ad">
      <a class="result__a" href="javascript:void(0)">Not a real link</a>
    </div>
  </div>
</body></html>`

const CHALLENGE_HTML = `<html><body><h1>Just a moment...</h1><div id="cf_chl_opt"></div>${'x'.repeat(3000)}</body></html>`

describe('extractSerpResults', () => {
  it('reads title, url and snippet, unwrapping the engine redirector', () => {
    const results = extractSerpResults(DDG_HTML, SERP_PROFILES['ddg-html'].selector, 'https://html.duckduckgo.com/html/', 10)

    expect(results).toEqual([
      { url: 'https://example.com/one', title: 'First & best', snippet: 'Snippet one here.' },
      { url: 'https://other.org/two', title: 'Second result', snippet: 'Snippet two.' },
    ])
  })

  it('keeps text that spans nested inline markup', () => {
    const html = `<a class="result__a" href="https://e.com/x">Deep <b>bold <i>and</i></b> tail</a>`
    const results = extractSerpResults(html, SERP_PROFILES['ddg-html'].selector, 'https://e.com/', 10)
    expect(results[0].title).toBe('Deep bold and tail')
  })

  it('drops entries whose href is not http(s)', () => {
    const results = extractSerpResults(DDG_HTML, SERP_PROFILES['ddg-html'].selector, 'https://html.duckduckgo.com/html/', 10)
    expect(results.map((result) => result.title)).not.toContain('Not a real link')
  })

  it('respects the requested limit', () => {
    const results = extractSerpResults(DDG_HTML, SERP_PROFILES['ddg-html'].selector, 'https://html.duckduckgo.com/html/', 1)
    expect(results).toHaveLength(1)
  })

  it('returns nothing when the markup does not match', () => {
    expect(extractSerpResults('<html><body><p>nope</p></body></html>', SERP_PROFILES['ddg-html'].selector, 'https://x/', 10)).toEqual([])
  })
})

describe('serp adapter', () => {
  it('returns results from the first engine that answers', async () => {
    const http = createStubHttpClient(() => ({ body: DDG_HTML }))
    const adapter = createSerpAdapter({})

    const outcome = await adapter.search({ query: 'test', limit: 10 }, createTestContext({ http }))

    expect(outcome.status).toBe('ok')
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0]).toContain('html.duckduckgo.com')
  })

  it('falls through to the next engine when the first is blocked', async () => {
    const isDuckDuckGoHtmlHost = (candidateUrl: string) => {
      try {
        return new URL(candidateUrl).hostname === 'html.duckduckgo.com'
      } catch {
        return false
      }
    }

    const http = createStubHttpClient((url) =>
      isDuckDuckGoHtmlHost(url)
        ? { body: CHALLENGE_HTML, status: 200 }
        : { body: DDG_HTML.replace(/result__a/g, 'result-link').replace(/result__snippet/g, 'result-snippet') },
    )
    const adapter = createSerpAdapter({})

    const outcome = await adapter.search({ query: 'test', limit: 10 }, createTestContext({ http }))

    expect(outcome.status).toBe('ok')
    expect(http.calls).toHaveLength(2)
  })

  it('reports a substantial unparseable page as blocked, not empty', async () => {
    // Stale selectors must surface as a fault. Reporting `empty` would let the
    // engine quietly return nothing forever after a markup change.
    const http = createStubHttpClient(() => ({ body: `<html><body>${'<div>x</div>'.repeat(400)}</body></html>` }))
    const adapter = createSerpAdapter({ engines: ['ddg-html'] })

    const outcome = await adapter.search({ query: 'test', limit: 10 }, createTestContext({ http }))

    expect(outcome.status).toBe('blocked')
    if (outcome.status === 'blocked') expect(outcome.reason).toContain('selectors may be stale')
  })

  it('reports a tiny empty page as empty', async () => {
    const http = createStubHttpClient(() => ({ body: '<html><body></body></html>' }))
    const adapter = createSerpAdapter({ engines: ['ddg-html'] })

    const outcome = await adapter.search({ query: 'test', limit: 10 }, createTestContext({ http }))

    expect(outcome.status).toBe('empty')
  })

  it('passes site and freshness filters through to the engine URL', async () => {
    const http = createStubHttpClient(() => ({ body: DDG_HTML }))
    const adapter = createSerpAdapter({ engines: ['ddg-html'] })

    await adapter.search(
      { query: 'pricing', limit: 5, site: 'example.com', freshness: 'week', locale: 'en-US' },
      createTestContext({ http }),
    )

    const requested = decodeURIComponent(http.calls[0])
    expect(requested).toContain('site:example.com')
    expect(requested).toContain('df=w')
    expect(requested).toContain('kl=en-us')
  })

  it('stops early when the caller aborts', async () => {
    const http = createStubHttpClient(() => ({ body: CHALLENGE_HTML }))
    const controller = new AbortController()
    controller.abort()
    const adapter = createSerpAdapter({})

    const outcome = await adapter.search(
      { query: 'test', limit: 10 },
      createTestContext({ http, signal: controller.signal }),
    )

    expect(outcome.status).toBe('empty')
    expect(http.calls).toHaveLength(0)
  })
})

describeAdapterContract(
  serpAdapterModule,
  {
    configuredOptions: {},
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: DDG_HTML })) }),
  },
  { describe, it, expect: expect as never },
)
