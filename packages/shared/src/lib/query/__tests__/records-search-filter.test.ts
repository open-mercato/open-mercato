/** @jest-environment node */
import { normalizeFilters } from '../join-utils'

/**
 * The custom-entity records API builds a pagination-aware server-side search as a
 * top-level `$or` of `$ilike` clauses (one per searchable field) ANDed with the
 * tenant/org scope (#3229). This verifies the filter shape it produces normalizes
 * into the orGroup disjuncts + lifted common clause that the query engine consumes,
 * so the search applies before pagination instead of only on the current page.
 */
describe('records server-side search filter normalization', () => {
  it('expands an $or of $ilike clauses into orGroup-tagged disjuncts', () => {
    const filters = {
      $or: [
        { id: { $ilike: '%berlin%' } },
        { title: { $ilike: '%berlin%' } },
        { location: { $ilike: '%berlin%' } },
      ],
    }
    const normalized = normalizeFilters(filters)
    const groups = new Set(normalized.map((f) => f.orGroup))
    expect(groups.size).toBe(3)
    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'id', op: 'ilike', value: '%berlin%' }),
        expect.objectContaining({ field: 'title', op: 'ilike', value: '%berlin%' }),
        expect.objectContaining({ field: 'location', op: 'ilike', value: '%berlin%' }),
      ]),
    )
  })

  it('lifts the ANDed org scope out of the search disjuncts as a common clause', () => {
    const filters = {
      organization_id: { $in: ['org-1'] },
      $or: [
        { title: { $ilike: '%abc%' } },
        { location: { $ilike: '%abc%' } },
      ],
    }
    const normalized = normalizeFilters(filters)
    const common = normalized.filter((f) => !f.orGroup)
    const disjuncts = normalized.filter((f) => f.orGroup)
    expect(common).toEqual([
      expect.objectContaining({ field: 'organization_id', op: 'in', value: ['org-1'] }),
    ])
    expect(new Set(disjuncts.map((f) => f.orGroup)).size).toBe(2)
    expect(disjuncts.map((f) => f.field).sort()).toEqual(['location', 'title'])
  })

  it('keeps a single-field search as a plain AND clause (no orGroup)', () => {
    const filters = { $or: [{ id: { $ilike: '%x%' } }] }
    const normalized = normalizeFilters(filters)
    expect(normalized).toEqual([
      expect.objectContaining({ field: 'id', op: 'ilike', value: '%x%' }),
    ])
    expect(normalized.every((f) => !f.orGroup)).toBe(true)
  })
})
