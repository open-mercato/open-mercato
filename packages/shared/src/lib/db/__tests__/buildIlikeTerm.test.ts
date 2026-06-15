import { buildIlikeTerm } from '../buildIlikeTerm'
import { escapeLikePattern } from '../escapeLikePattern'

describe('buildIlikeTerm', () => {
  it('wraps the escaped term in leading and trailing wildcards by default', () => {
    expect(buildIlikeTerm('acme')).toBe('%acme%')
  })

  it('matches the legacy inline contains pattern exactly', () => {
    const term = 'Acme Corp'
    expect(buildIlikeTerm(term)).toBe(`%${escapeLikePattern(term)}%`)
    expect(buildIlikeTerm(term, 'contains')).toBe(`%${escapeLikePattern(term)}%`)
  })

  it('builds a startsWith pattern with only a trailing wildcard', () => {
    const term = 'user@example.com'
    expect(buildIlikeTerm(term, 'startsWith')).toBe(`${escapeLikePattern(term)}%`)
  })

  it('builds an endsWith pattern with only a leading wildcard', () => {
    const term = 'example.com'
    expect(buildIlikeTerm(term, 'endsWith')).toBe(`%${escapeLikePattern(term)}`)
  })

  it('escapes LIKE metacharacters so they match literally', () => {
    expect(buildIlikeTerm('50%_off')).toBe('%50\\%\\_off%')
    expect(buildIlikeTerm('back\\slash')).toBe('%back\\\\slash%')
  })

  it('keeps user wildcards literal across every mode', () => {
    expect(buildIlikeTerm('a%b', 'startsWith')).toBe('a\\%b%')
    expect(buildIlikeTerm('a_b', 'endsWith')).toBe('%a\\_b')
  })

  it('handles an empty term as a wildcard-only pattern', () => {
    expect(buildIlikeTerm('')).toBe('%%')
    expect(buildIlikeTerm('', 'startsWith')).toBe('%')
    expect(buildIlikeTerm('', 'endsWith')).toBe('%')
  })
})
