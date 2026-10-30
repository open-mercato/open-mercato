import { buildSqlInClause } from '../sqlInClause'

describe('buildSqlInClause', () => {
  it('renders one placeholder per member', () => {
    const clause = buildSqlInClause('time_project_id', ['a', 'b', 'c'])
    expect(clause.sql).toBe('time_project_id IN (?, ?, ?)')
    expect(clause.params).toEqual(['a', 'b', 'c'])
  })

  it('never binds the list as a single array parameter', () => {
    // MikroORM interpolates parameters itself, so an array bound to one
    // placeholder reaches PostgreSQL as a bare comma-separated list — the
    // `malformed array literal` failure this helper exists to prevent.
    const clause = buildSqlInClause('organization_id', ['only-one'])
    expect(clause.sql).not.toContain('ANY')
    expect(clause.params).toEqual(['only-one'])
    expect(Array.isArray(clause.params[0])).toBe(false)
  })

  it('selects nothing rather than widening when the list is empty', () => {
    const clause = buildSqlInClause('id', [])
    expect(clause.sql).toBe('id IN (NULL)')
    expect(clause.params).toEqual([])
  })
})
