import { buildOpenDealPredicate } from '../dealsSummaryOpenPredicate'

describe('buildOpenDealPredicate', () => {
  it('requires an allowed status and no recorded closure outcome', () => {
    expect(buildOpenDealPredicate(['open', 'in_progress'])).toEqual({
      clause: 'status IN (?,?) AND closure_outcome IS NULL',
      values: ['open', 'in_progress'],
    })
  })

  it('supports a single-status open subset without changing NULL semantics', () => {
    expect(buildOpenDealPredicate(['open'])).toEqual({
      clause: 'status IN (?) AND closure_outcome IS NULL',
      values: ['open'],
    })
  })

  it('rejects an empty status set', () => {
    expect(() => buildOpenDealPredicate([])).toThrow(
      '[internal] Open-deal predicate requires at least one status',
    )
  })
})
