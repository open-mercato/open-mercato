import { canonicalizeUrl } from '../canonicalize'
import { fuseResults, type FusionInput } from '../fuse'

const OPTIONS = { limit: 10, minResults: 1, minConfidence: 0, maxPerDomain: 10 }

/**
 * Matches on the registrable host rather than a URL substring: `includes()`
 * would also match a host that merely embeds the name (`farm.com.evil.test`),
 * which is both a weaker assertion and a CodeQL finding.
 */
const hostOf = (url: string): string => new URL(url).hostname.replace(/^www\./, '')

describe('canonicalizeUrl', () => {
  it('strips tracking parameters but keeps meaningful ones', () => {
    const canonical = canonicalizeUrl('https://example.com/a?utm_source=x&id=7&fbclid=y')
    expect(canonical?.url).toBe('https://example.com/a?id=7')
  })

  it('drops the fragment and trailing slash', () => {
    expect(canonicalizeUrl('https://example.com/a/#section')?.url).toBe('https://example.com/a')
  })

  it('orders query parameters so equivalent URLs collapse', () => {
    const left = canonicalizeUrl('https://example.com/a?b=2&a=1')
    const right = canonicalizeUrl('https://example.com/a?a=1&b=2')
    expect(left?.key).toBe(right?.key)
  })

  it('folds www into the dedup key while keeping the URL fetchable', () => {
    const withWww = canonicalizeUrl('https://www.example.com/a')
    const without = canonicalizeUrl('https://example.com/a')
    expect(withWww?.key).toBe(without?.key)
    expect(withWww?.url).toBe('https://www.example.com/a')
  })

  it('unwraps a DuckDuckGo redirect', () => {
    const canonical = canonicalizeUrl(
      'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freal&rut=abc',
    )
    expect(canonical?.url).toBe('https://example.com/real')
  })

  it('rejects a DuckDuckGo sponsored link', () => {
    // Ads sit in the same markup as organic hits, so the SERP parser picks them
    // up; left alone they survive a `site:` filter and an agent cites an advert.
    const advert =
      'https://duckduckgo.com/y.js?ad_domain=udemy.com&ad_provider=bingv7aa&ad_type=txad&u3=https%3A%2F%2Fwww.bing.com%2Faclick'
    expect(canonicalizeUrl(advert)).toBeNull()
  })

  it('keeps an ordinary duckduckgo.com page', () => {
    expect(canonicalizeUrl('https://duckduckgo.com/about')?.url).toBe('https://duckduckgo.com/about')
  })

  it('unwraps a Google redirect', () => {
    expect(canonicalizeUrl('https://www.google.com/url?q=https://example.com/x')?.url).toBe(
      'https://example.com/x',
    )
  })

  it('rejects non-http schemes and malformed input', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull()
    expect(canonicalizeUrl('not a url')).toBeNull()
  })
})

describe('fuseResults', () => {
  it('ranks a hit found by two adapters above one found by a single adapter first', () => {
    const inputs: FusionInput[] = [
      {
        adapterId: 'alpha',
        weight: 1,
        results: [{ url: 'https://a.com/1' }, { url: 'https://shared.com/x' }],
      },
      {
        adapterId: 'beta',
        weight: 1,
        results: [{ url: 'https://b.com/1' }, { url: 'https://shared.com/x' }],
      },
    ]
    const { results } = fuseResults(inputs, OPTIONS)
    expect(results[0].url).toBe('https://shared.com/x')
    expect(results[0].sources).toHaveLength(2)
  })

  it('does not let one adapter outvote genuine agreement by repeating a URL', () => {
    const inputs: FusionInput[] = [
      {
        adapterId: 'noisy',
        weight: 1,
        results: [
          { url: 'https://noisy.com/x' },
          { url: 'https://noisy.com/x?utm_source=feed' },
          { url: 'https://www.noisy.com/x/' },
        ],
      },
      { adapterId: 'alpha', weight: 1, results: [{ url: 'https://shared.com/y' }] },
      { adapterId: 'beta', weight: 1, results: [{ url: 'https://shared.com/y' }] },
    ]
    const { results } = fuseResults(inputs, OPTIONS)

    expect(results[0].url).toBe('https://shared.com/y')
    expect(results.find((hit) => hostOf(hit.url) === 'noisy.com')?.sources).toHaveLength(1)
  })

  it('deduplicates across adapters and merges provenance', () => {
    const inputs: FusionInput[] = [
      { adapterId: 'alpha', weight: 1, results: [{ url: 'https://example.com/a?utm_source=x' }] },
      { adapterId: 'beta', weight: 1, results: [{ url: 'https://www.example.com/a/' }] },
    ]
    const { results } = fuseResults(inputs, OPTIONS)
    expect(results).toHaveLength(1)
    expect(results[0].sources.map((source) => source.adapterId)).toEqual(['alpha', 'beta'])
  })

  it('prefers the longest title and snippet when adapters disagree', () => {
    const inputs: FusionInput[] = [
      { adapterId: 'alpha', weight: 1, results: [{ url: 'https://e.com/a', title: 'Short', snippet: 'a' }] },
      {
        adapterId: 'beta',
        weight: 1,
        results: [{ url: 'https://e.com/a', title: 'A much longer title', snippet: 'a longer snippet' }],
      },
    ]
    const { results } = fuseResults(inputs, OPTIONS)
    expect(results[0].title).toBe('A much longer title')
    expect(results[0].snippet).toBe('a longer snippet')
  })

  it('applies adapter weight to the fused score', () => {
    const inputs: FusionInput[] = [
      { adapterId: 'trusted', weight: 5, results: [{ url: 'https://trusted.com/x' }] },
      { adapterId: 'weak', weight: 1, results: [{ url: 'https://weak.com/x' }] },
    ]
    const { results } = fuseResults(inputs, OPTIONS)
    expect(results[0].url).toBe('https://trusted.com/x')
    expect(results[0].confidence).toBe(1)
  })

  it('caps results per domain', () => {
    const inputs: FusionInput[] = [
      {
        adapterId: 'alpha',
        weight: 1,
        results: [
          { url: 'https://farm.com/1' },
          { url: 'https://farm.com/2' },
          { url: 'https://farm.com/3' },
          { url: 'https://other.com/1' },
        ],
      },
    ]
    const { results } = fuseResults(inputs, { ...OPTIONS, maxPerDomain: 2, minResults: 1 })
    const farmHits = results.filter((result) => hostOf(result.url) === 'farm.com')
    expect(farmHits).toHaveLength(2)
    expect(results.map((result) => result.url)).toContain('https://other.com/1')
  })

  it('skips results whose URL cannot be canonicalized', () => {
    const inputs: FusionInput[] = [
      { adapterId: 'alpha', weight: 1, results: [{ url: 'garbage' }, { url: 'https://ok.com/1' }] },
    ]
    const { results } = fuseResults(inputs, OPTIONS)
    expect(results.map((result) => result.url)).toEqual(['https://ok.com/1'])
  })

  it('relaxes the confidence threshold rather than returning nothing', () => {
    const inputs: FusionInput[] = [
      {
        adapterId: 'alpha',
        weight: 1,
        results: [{ url: 'https://a.com/1' }, { url: 'https://b.com/2' }, { url: 'https://c.com/3' }],
      },
    ]
    const { results, degraded } = fuseResults(inputs, {
      ...OPTIONS,
      minConfidence: 0.99,
      minResults: 3,
    })
    expect(results.length).toBe(3)
    expect(degraded).toBe(true)
  })

  it('is deterministic for equally scored hits', () => {
    const inputs: FusionInput[] = [
      { adapterId: 'alpha', weight: 1, results: [{ url: 'https://z.com/1' }] },
      { adapterId: 'beta', weight: 1, results: [{ url: 'https://a.com/1' }] },
    ]
    const first = fuseResults(inputs, OPTIONS).results.map((result) => result.url)
    const second = fuseResults(inputs, OPTIONS).results.map((result) => result.url)
    expect(first).toEqual(second)
    expect(first[0]).toBe('https://a.com/1')
  })

  it('returns nothing when every adapter returned nothing', () => {
    expect(fuseResults([], OPTIONS)).toEqual({ results: [], degraded: false })
  })
})
