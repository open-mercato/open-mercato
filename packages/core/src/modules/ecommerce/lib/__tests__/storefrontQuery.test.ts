import {
  isStorefrontQueryError,
  parseStorefrontProductDetailQuery,
  parseStorefrontProductListQuery,
  StorefrontQueryError,
} from '../storefrontQuery'

function parse(query: string) {
  return parseStorefrontProductListQuery(new URLSearchParams(query))
}

function rejection(query: string): StorefrontQueryError {
  try {
    parse(query)
  } catch (error) {
    if (isStorefrontQueryError(error)) return error
    throw error
  }
  throw new Error('[internal] expected the query to be rejected')
}

describe('parseStorefrontProductListQuery', () => {
  it('applies the defaults for an empty query', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 24, availability: 'all' })
  })

  it('parses the full grammar', () => {
    const parsed = parse(
      'page=2&pageSize=48&search=sukienka&categorySlug=dresses&tagSlugs=sale,new,sale&priceMin=50&priceMax=200' +
        '&options[color]=red,blue&options[size]=xl&productType=configurable&availability=in_stock&sort=price_asc' +
        '&locale=pl&path=/shop&storeSlug=main',
    )
    expect(parsed).toEqual({
      page: 2,
      pageSize: 48,
      search: 'sukienka',
      categorySlug: 'dresses',
      tagSlugs: ['sale', 'new'],
      priceMin: 50,
      priceMax: 200,
      options: { color: ['red', 'blue'], size: ['xl'] },
      productType: 'configurable',
      availability: 'in_stock',
      sort: 'price_asc',
      locale: 'pl',
      path: '/shop',
      storeSlug: 'main',
    })
  })

  it('parses bracket options from an encoded query string and trims values', () => {
    const parsed = parse('options%5Bcolor%5D=%20red%20,,blue')
    expect(parsed.options).toEqual({ color: ['red', 'blue'] })
  })

  it('rejects unknown parameters with a 400 naming them (R6)', () => {
    const error = rejection('categoryID=abc&search=x')
    expect(error.status).toBe(400)
    expect(error.code).toBe('unknown_parameter')
    expect(error.issues.map((issue) => issue.parameter)).toEqual(['categoryID'])
  })

  it('rejects pageSize above 100', () => {
    const error = rejection('pageSize=101')
    expect(error.status).toBe(400)
    expect(error.code).toBe('invalid_parameter')
    expect(error.issues[0].parameter).toBe('pageSize')
  })

  it('rejects repeated parameters instead of picking one', () => {
    expect(rejection('sort=newest&sort=price_asc').code).toBe('duplicate_parameter')
    expect(rejection('options[color]=red&options[color]=blue').code).toBe('duplicate_parameter')
  })

  it('rejects malformed option parameters', () => {
    expect(rejection('options=red').code).toBe('invalid_parameter')
    expect(rejection('options[]=red').code).toBe('invalid_parameter')
    expect(rejection('options[color]=,').code).toBe('invalid_parameter')
    const invalidCode = rejection('options[co lor]=red')
    expect(invalidCode.code).toBe('invalid_parameter')
    expect(invalidCode.issues[0].parameter).toBe('options[co lor]')
  })

  it('rejects invalid enum values, a non-uuid categoryId and an inverted price range', () => {
    expect(rejection('sort=cheapest').issues[0].parameter).toBe('sort')
    expect(rejection('availability=maybe').issues[0].parameter).toBe('availability')
    expect(rejection('categoryId=not-a-uuid').issues[0].parameter).toBe('categoryId')
    expect(rejection('priceMin=200&priceMax=50').issues[0].parameter).toBe('priceMax')
    expect(rejection('priceMin=-1').issues[0].parameter).toBe('priceMin')
  })

  it('rejects categoryId together with categorySlug', () => {
    const error = rejection('categoryId=7f1b4c9e-2a3d-4e5f-8a6b-1c2d3e4f5a6b&categorySlug=dresses')
    expect(error.code).toBe('invalid_parameter')
  })

  it('accepts a plain record input', () => {
    expect(parseStorefrontProductListQuery({ sort: 'newest', 'options[size]': 'm' })).toMatchObject({
      sort: 'newest',
      options: { size: ['m'] },
    })
  })
})

describe('parseStorefrontProductDetailQuery', () => {
  const VARIANT_ID = '77777777-7777-4777-8777-777777777777'

  function detailRejection(query: string): StorefrontQueryError {
    try {
      parseStorefrontProductDetailQuery(new URLSearchParams(query))
    } catch (error) {
      if (isStorefrontQueryError(error)) return error
      throw error
    }
    throw new Error('[internal] expected the query to be rejected')
  }

  it('parses variantId, locale and the store-resolution parameters', () => {
    expect(
      parseStorefrontProductDetailQuery(new URLSearchParams(`variantId=${VARIANT_ID}&locale=de&path=/b2b&storeSlug=main`)),
    ).toEqual({ variantId: VARIANT_ID, locale: 'de', path: '/b2b', storeSlug: 'main' })
    expect(parseStorefrontProductDetailQuery(new URLSearchParams('variantId='))).toEqual({})
  })

  it('rejects unknown, repeated and malformed parameters', () => {
    const unknown = detailRejection('variant=1')
    expect(unknown.code).toBe('unknown_parameter')
    expect(unknown.issues).toEqual([{ parameter: 'variant', message: 'unknown parameter' }])
    const duplicate = detailRejection('locale=de&locale=en')
    expect(duplicate.code).toBe('duplicate_parameter')
    expect(duplicate.issues.map((issue) => issue.parameter)).toEqual(['locale'])
    const malformed = detailRejection('variantId=not-a-uuid')
    expect(malformed.code).toBe('invalid_parameter')
    expect(malformed.issues.map((issue) => issue.parameter)).toEqual(['variantId'])
    expect(malformed.status).toBe(400)
  })
})
