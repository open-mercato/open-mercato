import {
  findSubdivision,
  getSelectableSubdivisions,
  getSubdivisions,
  isValidSubdivision,
} from '../subdivisions'

describe('getSelectableSubdivisions', () => {
  it('offers the 50 states plus the District of Columbia for US', () => {
    const selectable = getSelectableSubdivisions('US')
    expect(selectable).toHaveLength(51)
    expect(selectable.filter((entry) => entry.type === 'state')).toHaveLength(50)
    expect(selectable.map((entry) => entry.code)).toContain('DC')
  })

  it('keeps the table order, so the states stay alphabetical and DC comes last', () => {
    const codes = getSelectableSubdivisions('US').map((entry) => entry.code)
    expect(codes[0]).toBe('AL')
    expect(codes[codes.length - 1]).toBe('DC')
  })

  it('leaves the territories out of the picker while they stay valid values', () => {
    const codes = getSelectableSubdivisions('US').map((entry) => entry.code)
    expect(codes).not.toContain('PR')
    expect(codes).not.toContain('GU')
    expect(isValidSubdivision('US', 'PR')).toBe(true)
    expect(getSubdivisions('US')).toHaveLength(56)
  })

  it('normalizes the country code the way getSubdivisions does', () => {
    expect(getSelectableSubdivisions(' us ')).toHaveLength(51)
  })

  it('is empty for a country with no list and for blank input', () => {
    expect(getSelectableSubdivisions('PL')).toHaveLength(0)
    expect(getSelectableSubdivisions('')).toHaveLength(0)
    expect(getSelectableSubdivisions(null)).toHaveLength(0)
    expect(getSelectableSubdivisions(undefined)).toHaveLength(0)
  })
})

describe('findSubdivision', () => {
  it('matches by code', () => {
    expect(findSubdivision('US', 'TX')?.name).toBe('Texas')
  })

  it('matches a legacy full name, case-insensitively and trimmed', () => {
    expect(findSubdivision('US', 'Texas')?.code).toBe('TX')
    expect(findSubdivision('US', 'texas')?.code).toBe('TX')
    expect(findSubdivision('US', '  TEXAS  ')?.code).toBe('TX')
    expect(findSubdivision('US', ' tx ')?.code).toBe('TX')
  })

  it('matches a multi-word name and the district', () => {
    expect(findSubdivision('US', 'new york')?.code).toBe('NY')
    expect(findSubdivision('US', 'District of Columbia')?.code).toBe('DC')
  })

  it('matches a territory, which is valid data even though the picker omits it', () => {
    expect(findSubdivision('US', 'PR')?.name).toBe('Puerto Rico')
    expect(findSubdivision('US', 'Puerto Rico')?.code).toBe('PR')
  })

  it('returns null for an unknown value, an unknown country and blank input', () => {
    expect(findSubdivision('US', 'Mazowieckie')).toBeNull()
    expect(findSubdivision('US', 'Tx.')).toBeNull()
    expect(findSubdivision('PL', 'Mazowieckie')).toBeNull()
    expect(findSubdivision('US', '')).toBeNull()
    expect(findSubdivision('US', '   ')).toBeNull()
    expect(findSubdivision('US', null)).toBeNull()
    expect(findSubdivision(null, 'TX')).toBeNull()
  })

  it('prefers a code match over a name match', () => {
    expect(findSubdivision('US', 'IN')?.code).toBe('IN')
  })
})
