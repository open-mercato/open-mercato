import { LINK_REPORT_LIMIT, buildLinkReport } from '../links'

const row = (url: string, people: number, clicks: number, stepIds: string[] | null = ['s1']) => ({
  url,
  people,
  clicks,
  step_ids: stepIds,
})

describe('buildLinkReport', () => {
  it('shares each link against everyone who clicked anything', () => {
    const report = buildLinkReport([row('https://shop.example/a', 30, 45), row('https://shop.example/b', 10, 10)], 40)
    expect(report.clickers).toBe(40)
    expect(report.links[0]).toMatchObject({ url: 'https://shop.example/a', people: 30, clicks: 45, shareOfClickers: 0.75 })
    expect(report.links[1].shareOfClickers).toBe(0.25)
  })

  /**
   * The shares overlap on purpose, and this test is here so nobody "fixes" it into a pie.
   *
   * Two links each clicked by most of the clickers sum past one because a person who clicked both is in both
   * populations. Normalising would answer a different question — share of CLICKS — and quietly make a link that
   * one person clicked twice look as popular as a link two people clicked once.
   */
  it('lets the shares sum past one, because the populations overlap', () => {
    const report = buildLinkReport([row('https://shop.example/a', 9, 9), row('https://shop.example/b', 8, 8)], 10)
    const total = report.links.reduce((sum, link) => sum + (link.shareOfClickers ?? 0), 0)
    expect(total).toBeGreaterThan(1)
  })

  /** A rate over nobody is not a rate of nothing — the same rule as every other rate in this module. */
  it('reports a null share when nobody clicked anything', () => {
    const report = buildLinkReport([row('https://shop.example/a', 0, 0)], 0)
    expect(report.links[0].shareOfClickers).toBeNull()
  })

  it('de-duplicates and orders the steps a link appeared in', () => {
    const report = buildLinkReport([row('https://shop.example/a', 2, 2, ['s2', 's1', 's2'])], 2)
    expect(report.links[0].stepIds).toEqual(['s1', 's2'])
  })

  /** A driver that answers `null` for an empty aggregate must not produce `[null]`. */
  it('survives a row with no steps recorded', () => {
    expect(buildLinkReport([row('https://shop.example/a', 1, 1, null)], 1).links[0].stepIds).toEqual([])
  })

  /**
   * The ceiling is detected by the extra row, and REPORTED.
   *
   * This module has shipped a truncated count presented as a total once already; the loader asks for one row
   * more than it will show precisely so this flag can be honest without a second query.
   */
  it('says when the ranking was cut, and does not include the sentinel row', () => {
    const rows = Array.from({ length: LINK_REPORT_LIMIT + 1 }, (_, index) => row(`https://shop.example/${index}`, 1, 1))
    const report = buildLinkReport(rows, 1)
    expect(report.truncated).toBe(true)
    expect(report.links).toHaveLength(LINK_REPORT_LIMIT)
  })

  it('does not claim truncation when the rows exactly fill the limit', () => {
    const rows = Array.from({ length: LINK_REPORT_LIMIT }, (_, index) => row(`https://shop.example/${index}`, 1, 1))
    expect(buildLinkReport(rows, 1).truncated).toBe(false)
  })
})
