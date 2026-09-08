/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'

// Regression for the fleet-overview header overlap (issue #5990): the UI
// primitive `TableHead` ships `whitespace-nowrap`, and a table cell does not
// clip its overflow — so a column header wider than its column is painted on
// top of the next header instead of being wrapped or hidden. Under
// `table-fixed` the column width is a declared constant, which turns every
// translation longer than the English original ("Uruchomienia" for "Runs",
// "Überschreibungen" for "Override") into an overlap.
//
// The module has no page-level RTL harness, and jsdom performs no layout, so
// the invariant is asserted on the source in the style of
// `overview-honesty.test.ts`: no header may keep the nowrap default, and the
// tables must live in a scroll container rather than under a clipping panel.
describe('agent_orchestrator fleet overview — column headers never overlap (issue #5990)', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const overviewSource = read('backend/overview/page.tsx')
  const healthTileSource = read('components/SystemHealthTile.tsx')

  const headTags = overviewSource.match(/<TableHead(?![A-Za-z])[^>]*>/g) ?? []

  it('still renders the two panel tables the invariant is about', () => {
    expect(headTags.length).toBeGreaterThanOrEqual(10)
  })

  it.each(headTags.map((tag, index) => [index, tag] as const))(
    'header %i wraps instead of overflowing its cell',
    (_index, tag) => {
      expect(tag).toContain('WRAPPING_HEAD')
    },
  )

  it('defines the wrapping rule as wrap + a hard break point, not a nowrap override alone', () => {
    const declaration = overviewSource.match(/const WRAPPING_HEAD = '([^']+)'/)
    expect(declaration).not.toBeNull()
    const classes = (declaration?.[1] ?? '').split(/\s+/)
    // `whitespace-normal` alone still lets an unbreakable compound word run
    // out of a narrow column; `break-words` is what makes overflow impossible.
    expect(classes).toContain('whitespace-normal')
    expect(classes).toContain('break-words')
  })

  it('keeps both overview tables inside a horizontal scroll container', () => {
    // The Panel is `overflow-hidden`: without a scroller, a table wider than
    // its panel loses its last column silently.
    const tables = overviewSource.match(/<div className="overflow-x-auto">\s*<Table/g) ?? []
    expect(tables.length).toBe(2)
  })

  it('sizes trust columns on the DS scale, with no arbitrary Tailwind widths', () => {
    for (const tag of headTags) {
      expect(tag).not.toMatch(/\bw-\[/)
      expect(tag).not.toMatch(/\btext-\[/)
    }
    // The numeric/meter/badge columns stay declared (that is what lets the
    // agent name absorb the remainder under `table-fixed`) …
    expect(overviewSource).toMatch(/WRAPPING_HEAD\} w-24 text-right/)
    // … and wide enough for their CONTENT: the override meter is ~88px.
    expect(overviewSource).toMatch(/WRAPPING_HEAD\} hidden w-32 2xl:table-cell/)
  })

  it('lets the system-health labels ellipse rather than overflow onto each other', () => {
    // A flex item will not shrink below its min-content width unless told to,
    // so `truncate` without `min-w-0` never engages.
    expect(healthTileSource).toMatch(/className="min-w-0 truncate"/)
  })

  describe('shipped translations', () => {
    const locales = ['en', 'pl', 'de', 'es', 'ko'] as const
    const columnKeys = [
      'agent_orchestrator.overview.trust.col.agent',
      'agent_orchestrator.overview.trust.col.override',
      'agent_orchestrator.overview.trust.col.runs',
      'agent_orchestrator.overview.trust.col.status',
      'agent_orchestrator.overview.stuck.col.waitingFor',
      'agent_orchestrator.overview.stuck.col.waitingTime',
    ]

    it.each(locales)('%s carries every overview column header', (locale) => {
      const data = JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>
      for (const key of columnKeys) expect(data[key]).toBeTruthy()
    })
  })
})
