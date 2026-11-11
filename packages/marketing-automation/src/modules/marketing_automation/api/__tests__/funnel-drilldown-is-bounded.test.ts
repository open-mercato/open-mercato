import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The campaign funnel's drill-down (`campaigns/[id]/runs`) must never rebuild the unbounded
 * `select distinct run_id … ; id IN (…)` pattern this route used to run on every request with an
 * `engagement` filter: on a large campaign the collected id list grows with the campaign, which is a
 * parameter list Postgres should not be asked to plan. The fix moved the check into
 * `buildEngagementRunFilter`'s correlated `exists (…)` subquery — this test pins the route to using it
 * instead of silently regressing back to collecting ids first.
 */
describe('the funnel drill-down stays a bounded query', () => {
  const source = readFileSync(
    join(__dirname, '../campaigns/[id]/runs/route.ts'),
    'utf8',
  )

  it('filters engagement through buildEngagementRunFilter', () => {
    expect(source).toContain('buildEngagementRunFilter')
  })

  it('never collects a distinct run_id list to filter runs by id', () => {
    expect(source).not.toMatch(/select\s+distinct\s+run_id/i)
    expect(source).not.toMatch(/id:\s*\{\s*\$in:\s*engagedRunIds/)
  })
})
