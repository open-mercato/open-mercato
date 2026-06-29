import { matchCacheKeyPattern } from '../patterns'

describe('matchCacheKeyPattern', () => {
  it('matches cache glob wildcards without regex execution', () => {
    expect(matchCacheKeyPattern('user:1', 'user:*')).toBe(true)
    expect(matchCacheKeyPattern('user:1', 'user:?')).toBe(true)
    expect(matchCacheKeyPattern('user:100', 'user:?')).toBe(false)
    expect(matchCacheKeyPattern('org:1', 'user:*')).toBe(false)
  })

  it('treats regex metacharacters as literal cache key characters', () => {
    expect(matchCacheKeyPattern('tenant:(a+)+', 'tenant:(*)+')).toBe(true)
    expect(matchCacheKeyPattern('tenant:(a+)+', 'tenant:.+')).toBe(false)
  })
})

