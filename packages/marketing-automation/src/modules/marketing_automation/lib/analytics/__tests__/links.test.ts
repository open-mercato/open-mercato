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
   * A personalised link — `{{customer.email}}` or `{{customer.displayName}}` interpolated into
   * the href before tracking is added — must never reach this report carrying a recipient's
   * value, and every recipient's variant of it must collapse back into one row rather than
   * splitting the ranking apart. An email has a detectable shape to redact; a name does not, so
   * the query string (where a send-step author puts per-recipient values) is dropped entirely
   * instead of matching placeholder-by-placeholder.
   *
   * `LINK_SQL` groups in Postgres, which this unit test cannot run, so it asserts the redaction
   * both ways: the SAME expression is used in the select list and the group by (so grouping and
   * output can never disagree), and a JS mirror of that expression — `split_part(url, '?', 1)`
   * then `EMAIL_PATTERN` — applied to realistic personalised links, actually removes the
   * per-recipient value rather than matching nothing.
   */
  it('redacts a personalised link before grouping, in both the select and the group by', () => {
    const redactedExpression = `regexp_replace(split_part(e.link_url, '?', 1), '${EMAIL_PATTERN.source}', '${REDACTED_EMAIL}', 'g')`
    const selectClause = LINK_SQL.slice(LINK_SQL.indexOf('select'), LINK_SQL.indexOf('from'))
    const groupByClause = LINK_SQL.slice(LINK_SQL.indexOf('group by'), LINK_SQL.indexOf('order by'))
    expect(selectClause).toContain(redactedExpression)
    expect(groupByClause).toContain(redactedExpression)

    // Mirrors the SQL expression: drop everything from the first `?` on, then redact any email
    // shape left in what remains.
    const redact = (url: string) => url.split('?')[0].replace(EMAIL_PATTERN, REDACTED_EMAIL)

    const emailPersonalised = 'https://shop.example/vip?email=alice@example.com'
    const otherRecipientEmail = 'https://shop.example/vip?email=bob@example.com'
    const namePersonalised = 'https://shop.example/vip?name=Alice+Smith'
    const plain = 'https://shop.example/vip'

    expect(redact(emailPersonalised)).toBe(plain)
    expect(redact(emailPersonalised)).not.toContain('alice@example.com')
    // Two different recipients' personalised links — by email or by name — reduce to the
    // identical grouping key, the same key the un-personalised link already has.
    expect(redact(otherRecipientEmail)).toBe(plain)
    expect(redact(namePersonalised)).toBe(plain)
    expect(redact(namePersonalised)).not.toContain('Alice')
  })
})
