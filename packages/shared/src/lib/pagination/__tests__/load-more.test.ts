import { hasMoreFromPage } from '../load-more'

describe('hasMoreFromPage', () => {
  it('reports more when the page came back full', () => {
    expect(hasMoreFromPage(24, 24)).toBe(true)
  })

  it('reports more when the endpoint served more than it was asked for', () => {
    // `>=` rather than `===`, so an over-serving endpoint still terminates.
    expect(hasMoreFromPage(25, 24)).toBe(true)
  })

  it('terminates on a short page', () => {
    expect(hasMoreFromPage(23, 24)).toBe(false)
  })

  it('terminates on an empty page', () => {
    expect(hasMoreFromPage(0, 24)).toBe(false)
  })

  // The served count is the contract (obligation 1 in the docstring): callers
  // must not pass a client-deduped length. Nothing here can enforce that, but
  // pinning the boundary keeps the `>=` from drifting to `===` or `>`.
  it('treats one row short of the page size as the end, one row over as more', () => {
    expect(hasMoreFromPage(1, 2)).toBe(false)
    expect(hasMoreFromPage(2, 2)).toBe(true)
    expect(hasMoreFromPage(3, 2)).toBe(true)
  })
})
