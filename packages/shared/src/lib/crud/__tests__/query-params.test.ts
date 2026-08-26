import { buildQueryParams, readQueryParamList, toQueryValueList } from '@open-mercato/shared/lib/crud/query-params'

describe('buildQueryParams', () => {
  it('keeps a key that occurs once as a plain string', () => {
    const params = new URLSearchParams('status=win&page=2')
    expect(buildQueryParams(params)).toEqual({ status: 'win', page: '2' })
  })

  it('keeps every value of a repeated key instead of the last one (#5548)', () => {
    const params = new URLSearchParams('status=win&status=loose')
    expect(buildQueryParams(params)).toEqual({ status: ['win', 'loose'] })
  })

  it('preserves the order the values were supplied in', () => {
    expect(buildQueryParams(new URLSearchParams('status=loose&status=win'))).toEqual({
      status: ['loose', 'win'],
    })
  })

  it('does not split a single value on commas, so comma contracts stay intact', () => {
    const params = new URLSearchParams('ids=a,b&search=Smith, John')
    expect(buildQueryParams(params)).toEqual({ ids: 'a,b', search: 'Smith, John' })
  })

  it('returns an empty object for an empty query string', () => {
    expect(buildQueryParams(new URLSearchParams(''))).toEqual({})
  })

  it('keeps an empty repeated value so the caller can decide what it means', () => {
    expect(buildQueryParams(new URLSearchParams('status=&status=win'))).toEqual({
      status: ['', 'win'],
    })
  })

  // A plain `out[key] = value` assignment runs the `__proto__` setter, which
  // would swap the returned object's prototype for the array and drop the key.
  // `Object.fromEntries` defines own data properties, matching what the parse
  // site did before this change.
  it('carries a __proto__ key as an own property instead of touching the prototype', () => {
    const repeated = buildQueryParams(new URLSearchParams('__proto__=a&__proto__=b'))
    expect(Object.getPrototypeOf(repeated)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(repeated, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(repeated, '__proto__')?.value).toEqual(['a', 'b'])

    const single = buildQueryParams(new URLSearchParams('__proto__=a'))
    expect(Object.getPrototypeOf(single)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(single, '__proto__')?.value).toBe('a')
  })

  it('rejects the Object.fromEntries shape this replaced', () => {
    // Regression guard: reverting the parse site to
    // `Object.fromEntries(url.searchParams.entries())` makes this fail.
    const params = new URLSearchParams('status=win&status=loose')
    expect(buildQueryParams(params)).not.toEqual(Object.fromEntries(params.entries()))
  })
})

describe('toQueryValueList', () => {
  it('turns a single string into a one-entry list', () => {
    expect(toQueryValueList('win')).toEqual(['win'])
  })

  it('splits the comma form', () => {
    expect(toQueryValueList('win,loose')).toEqual(['win', 'loose'])
  })

  it('flattens repeated values', () => {
    expect(toQueryValueList(['win', 'loose'])).toEqual(['win', 'loose'])
  })

  it('treats the mixed form as one flat list', () => {
    expect(toQueryValueList(['a,b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('trims entries and drops empty ones', () => {
    expect(toQueryValueList([' win ', '', ' , ', 'loose'])).toEqual(['win', 'loose'])
  })

  it('ignores non-string input', () => {
    expect(toQueryValueList(undefined)).toEqual([])
    expect(toQueryValueList(null)).toEqual([])
    expect(toQueryValueList(42)).toEqual([])
    expect(toQueryValueList([1, 'win'])).toEqual(['win'])
  })
})

describe('readQueryParamList', () => {
  it('reads the repeated and the comma form as the same list', () => {
    const repeated = new URLSearchParams('status=win&status=loose')
    const comma = new URLSearchParams('status=win,loose')
    expect(readQueryParamList(repeated, 'status')).toEqual(['win', 'loose'])
    expect(readQueryParamList(comma, 'status')).toEqual(['win', 'loose'])
  })

  it('returns an empty list for a key that was not supplied', () => {
    expect(readQueryParamList(new URLSearchParams('status=win'), 'ownerUserId')).toEqual([])
  })
})
