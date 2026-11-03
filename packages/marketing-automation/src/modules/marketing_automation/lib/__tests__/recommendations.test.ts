import {
  MAX_RECOMMENDATIONS,
  MINIMUM_AFFINITY_CUSTOMERS,
  rankRecommendations,
} from '../engine/recommendations'
import {
  applyRecommendations,
  productUrlFor,
  referencesRecommendations,
  renderRecommendationsHtml,
} from '../recommendations'

const affinity = (sku: string, distinctCustomers: number, coOccurrences = distinctCustomers) => ({
  sku,
  name: `Product ${sku}`,
  coOccurrences,
  distinctCustomers,
})

const bestSeller = (sku: string, orders: number) => ({ sku, name: `Product ${sku}`, orders })

describe('rankRecommendations', () => {
  it('prefers affinity over best sellers', () => {
    const result = rankRecommendations({
      affinity: [affinity('A', 3)],
      bestSellers: [bestSeller('B', 500)],
      alreadyPurchased: [],
      limit: 2,
    })
    expect(result.map((item) => item.sku)).toEqual(['A', 'B'])
    expect(result[0].source).toBe('affinity')
    expect(result[1].source).toBe('bestSeller')
  })

  it('ignores a pairing seen by too few customers', () => {
    const result = rankRecommendations({
      affinity: [affinity('A', MINIMUM_AFFINITY_CUSTOMERS - 1, 99)],
      bestSellers: [bestSeller('B', 1)],
      alreadyPurchased: [],
      limit: 2,
    })
    // 99 lines from one customer is an anecdote; it must not outrank a product nobody has evidence for.
    expect(result.map((item) => item.sku)).toEqual(['B'])
  })

  it('weighs distinct customers above raw line counts', () => {
    const result = rankRecommendations({
      affinity: [affinity('REPEAT', 2, 40), affinity('BROAD', 9, 9)],
      bestSellers: [],
      alreadyPurchased: [],
      limit: 2,
    })
    expect(result.map((item) => item.sku)).toEqual(['BROAD', 'REPEAT'])
  })

  it('never offers back something the customer already owns', () => {
    const result = rankRecommendations({
      affinity: [affinity('OWNED', 9), affinity('NEW', 3)],
      bestSellers: [bestSeller('OWNED', 900)],
      alreadyPurchased: ['OWNED'],
      limit: 5,
    })
    expect(result.map((item) => item.sku)).toEqual(['NEW'])
  })

  it('does not repeat a sku that both signals produced', () => {
    const result = rankRecommendations({
      affinity: [affinity('BOTH', 4)],
      bestSellers: [bestSeller('BOTH', 900), bestSeller('OTHER', 10)],
      alreadyPurchased: [],
      limit: 5,
    })
    expect(result.map((item) => item.sku)).toEqual(['BOTH', 'OTHER'])
  })

  it('is deterministic when the evidence ties, so a resend shows the same order', () => {
    const input = {
      affinity: [affinity('zebra', 4), affinity('apple', 4), affinity('mango', 4)],
      bestSellers: [],
      alreadyPurchased: [],
      limit: 3,
    }
    const first = rankRecommendations(input).map((item) => item.sku)
    const again = rankRecommendations(input).map((item) => item.sku)
    expect(first).toEqual(['apple', 'mango', 'zebra'])
    expect(again).toEqual(first)
  })

  it('answers best sellers alone for a customer with no history', () => {
    const result = rankRecommendations({
      affinity: [],
      bestSellers: [bestSeller('A', 5), bestSeller('B', 50)],
      alreadyPurchased: [],
      limit: 2,
    })
    expect(result.map((item) => item.sku)).toEqual(['B', 'A'])
  })

  it('respects the requested count, and the ceiling above it', () => {
    const many = Array.from({ length: 40 }, (_, index) => bestSeller(`S${String(index).padStart(2, '0')}`, 40 - index))
    expect(rankRecommendations({ affinity: [], bestSellers: many, alreadyPurchased: [], limit: 2 })).toHaveLength(2)
    expect(rankRecommendations({ affinity: [], bestSellers: many, alreadyPurchased: [], limit: 999 }))
      .toHaveLength(MAX_RECOMMENDATIONS)
    expect(rankRecommendations({ affinity: [], bestSellers: many, alreadyPurchased: [], limit: 0 })).toEqual([])
  })

  it('falls back to the sku when the snapshot carried no name', () => {
    const result = rankRecommendations({
      affinity: [],
      bestSellers: [{ sku: 'NAMELESS', name: '', orders: 3 }],
      alreadyPurchased: [],
      limit: 1,
    })
    expect(result[0].name).toBe('NAMELESS')
  })
})

describe('the {{recommendations}} placeholder', () => {
  it('is recognised however it is spaced or cased', () => {
    expect(referencesRecommendations('<p>{{recommendations}}</p>')).toBe(true)
    expect(referencesRecommendations('{{  Recommendations  }}')).toBe(true)
    expect(referencesRecommendations('<p>nothing here</p>')).toBe(false)
  })

  it('is repeatable within one body', () => {
    const html = applyRecommendations('<a>{{recommendations}}</a><b>{{recommendations}}</b>', '<i>x</i>')
    expect(html).toBe('<a><i>x</i></a><b><i>x</i></b>')
  })

  it('is removed rather than printed when there is nothing to show', () => {
    expect(applyRecommendations('<p>before{{recommendations}}after</p>', '')).toBe('<p>beforeafter</p>')
  })

  it('does not treat the substituted html as a further template', () => {
    // A `$&` in generated HTML would otherwise be expanded by String.replace into the matched text.
    expect(applyRecommendations('{{recommendations}}', '<p>$& $1</p>')).toBe('<p>$& $1</p>')
  })
})

describe('renderRecommendationsHtml', () => {
  const items = [
    { sku: 'A-1', name: 'Kettle', source: 'affinity' as const },
    { sku: 'B-2', name: 'Mug & Saucer <bold>', source: 'bestSeller' as const },
  ]

  it('renders nothing at all for an empty list', () => {
    expect(renderRecommendationsHtml([])).toBe('')
  })

  it('escapes names that came from a catalogue importer', () => {
    const html = renderRecommendationsHtml(items)
    expect(html).toContain('Mug &amp; Saucer &lt;bold&gt;')
    expect(html).not.toContain('<bold>')
  })

  it('links through the tenant template when there is one', () => {
    const html = renderRecommendationsHtml(items, { urlTemplate: 'https://shop.example/p/{sku}' })
    expect(html).toContain('href="https://shop.example/p/A-1"')
    expect(html).toContain('href="https://shop.example/p/B-2"')
  })

  it('renders plain names when the deployment has nowhere to send people', () => {
    const html = renderRecommendationsHtml(items, { urlTemplate: null })
    expect(html).not.toContain('href=')
    expect(html).toContain('Kettle')
  })

  it('never prints a price, because the snapshot records what somebody else paid', () => {
    const html = renderRecommendationsHtml(items, { urlTemplate: 'https://shop.example/p/{sku}' })
    expect(html).not.toMatch(/\d+[.,]\d{2}/)
  })
})

describe('productUrlFor', () => {
  it('requires the placeholder, so a template without one cannot produce a wrong link', () => {
    expect(productUrlFor('https://shop.example/product', 'A')).toBeNull()
    expect(productUrlFor(null, 'A')).toBeNull()
    expect(productUrlFor('', 'A')).toBeNull()
  })

  it('encodes the sku', () => {
    expect(productUrlFor('https://shop.example/p/{sku}', 'a b/c?d')).toBe('https://shop.example/p/a%20b%2Fc%3Fd')
  })
})
