import { LINK_REPORT_LIMIT, LINK_SQL, buildLinkReport } from '../links'
import { EMAIL_PATTERN, REDACTED_EMAIL } from '../../redact'

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

  /**
   * A personalised link — `{{customer.email}}` interpolated into the href before tracking is
   * added — must never reach this report as a raw address, and every recipient's variant of it
   * must collapse back into one row rather than splitting the ranking apart.
   *
   * `LINK_SQL` groups in Postgres, which this unit test cannot run, so it asserts the redaction
   * both ways: the SAME expression is used in the select list and the group by (so grouping and
   * output can never disagree), and the pattern embedded in the SQL — read back as a RegExp — is
   * `lib/redact.ts`'s own `EMAIL_PATTERN`, applied to a realistic personalised link, actually
   * removes the address rather than matching nothing.
   */
  it('redacts a personalised link before grouping, in both the select and the group by', () => {
    const redactedExpression = `regexp_replace(e.link_url, '${EMAIL_PATTERN.source}', '${REDACTED_EMAIL}', 'g')`
    const selectClause = LINK_SQL.slice(LINK_SQL.indexOf('select'), LINK_SQL.indexOf('from'))
    const groupByClause = LINK_SQL.slice(LINK_SQL.indexOf('group by'), LINK_SQL.indexOf('order by'))
    expect(selectClause).toContain(redactedExpression)
    expect(groupByClause).toContain(redactedExpression)

    const personalised = 'https://shop.example/vip?email=alice@example.com'
    const otherRecipient = 'https://shop.example/vip?email=bob@example.com'
    const redacted = personalised.replace(EMAIL_PATTERN, REDACTED_EMAIL)
    expect(redacted).toBe(`https://shop.example/vip?email=${REDACTED_EMAIL}`)
    expect(redacted).not.toContain('alice@example.com')
    // Two different recipients' personalised links reduce to the identical grouping key.
    expect(otherRecipient.replace(EMAIL_PATTERN, REDACTED_EMAIL)).toBe(redacted)
  })
})
