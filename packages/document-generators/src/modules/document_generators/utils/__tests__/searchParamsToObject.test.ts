import { searchParamsToObject } from '../searchParamsToObject'

describe('searchParamsToObject', () => {
  it('keeps the last value of a repeated parameter', () => {
    expect(searchParamsToObject(new URLSearchParams('page=1&page=3&format=pdf'))).toEqual({ page: '3', format: 'pdf' })
  })

  it('keeps every value of tags, in order', () => {
    expect(searchParamsToObject(new URLSearchParams('tags=a&tags=b&tags='))).toEqual({ tags: ['a', 'b', ''] })
    expect(searchParamsToObject(new URLSearchParams('tags=a'))).toEqual({ tags: ['a'] })
  })

  it('returns an empty object for an empty query', () => {
    expect(searchParamsToObject(new URLSearchParams(''))).toEqual({})
  })
})
