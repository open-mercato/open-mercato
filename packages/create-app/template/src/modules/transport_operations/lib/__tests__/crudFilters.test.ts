/** @jest-environment node */
/**
 * Pins the two filter helpers the transport list routes share.
 *
 * `withOrConditions` exists because of a defect that no type and no test caught for a long time: two
 * spread conditions that each carry `$or` overwrite one another, so a request with a search term *and*
 * an expiry filter silently dropped one of them and returned a plausible-looking page. `expiryCutoff`
 * is pinned so the "due within 30 days" window cannot drift away from the badge in the list.
 */
import { expiryCutoff, withOrConditions } from '../crudFilters'

describe('withOrConditions', () => {
  it('returns the base untouched when there is nothing to merge', () => {
    expect(withOrConditions({ status: { $eq: 'active' } }, [])).toEqual({ status: { $eq: 'active' } })
  })

  it('merges a single $or condition flat, which is what the query engine expects', () => {
    const merged = withOrConditions(
      { status: { $eq: 'active' } },
      [{ $or: [{ plate_number: { $ilike: '%AB%' } }] }],
    )
    expect(merged).toEqual({
      status: { $eq: 'active' },
      $or: [{ plate_number: { $ilike: '%AB%' } }],
    })
  })

  it('keeps both conditions when two of them carry $or', () => {
    const merged = withOrConditions({}, [
      { $or: [{ full_name: { $ilike: '%Salem%' } }] },
      { license_expiry: { $lte: '2026-10-27', $ne: null } },
    ])
    expect(merged).toEqual({
      $and: [
        { $or: [{ full_name: { $ilike: '%Salem%' } }] },
        { license_expiry: { $lte: '2026-10-27', $ne: null } },
      ],
    })
  })
})

describe('expiryCutoff', () => {
  const now = new Date('2026-09-27T09:00:00.000Z')
  const windows = { expired: 0, within30: 30 }

  it('has no cut-off when nothing was selected', () => {
    expect(expiryCutoff(undefined, windows, now)).toBeNull()
  })

  it('has no cut-off for a selection the route does not declare', () => {
    expect(expiryCutoff('tomorrow', windows, now)).toBeNull()
  })

  it('cuts at now for expired', () => {
    expect(expiryCutoff('expired', windows, now)?.toISOString()).toBe(now.toISOString())
  })

  it('cuts thirty days ahead for the renewal window', () => {
    expect(expiryCutoff('within30', windows, now)?.toISOString()).toBe('2026-10-27T09:00:00.000Z')
  })
})
