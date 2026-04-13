jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))

import { evaluateFilterConditions } from '../event-trigger-service'

describe('evaluateFilterConditions — ReDoS prevention', () => {
  const matchesRegex = (pattern: string, value: string): boolean => evaluateFilterConditions(
    [{ field: 'name', operator: 'regex', value: pattern }],
    { name: value },
  )

  it('rejects regex patterns longer than 200 characters', () => {
    expect(matchesRegex('a'.repeat(201), 'test')).toBe(false)
  })

  it('rejects quantified groups with nested quantifiers or alternation', () => {
    const patterns = [
      '(a+)+b',
      '(a*)*b',
      '(a+a+)+b',
      '([a-z]+)*$',
      '(a|aa)+b',
      '(.*|a)+$',
    ]

    for (const pattern of patterns) {
      expect(matchesRegex(pattern, 'aaaaaaaaaaaaaaaaaaaaaaaX')).toBe(false)
    }
  })

  it('rejects regex constructs that are hard to statically bound', () => {
    const patterns = [
      '(?=a+)a+',
      '(?!foo).*',
      '(?<=a)b',
      '(?<word>a)',
      '^(a+)\\1$',
      '\\k<word>',
    ]

    for (const pattern of patterns) {
      expect(matchesRegex(pattern, 'aaaa')).toBe(false)
    }
  })

  it('rejects test input longer than 10000 chars for regex operator', () => {
    expect(matchesRegex('^a+$', 'a'.repeat(10_001))).toBe(false)
  })

  it('allows safe regex patterns', () => {
    expect(matchesRegex('hello', 'hello world')).toBe(true)
    expect(matchesRegex('^order-\\d+$', 'order-123')).toBe(true)
    expect(matchesRegex('^[A-Z]{2}-\\d{3}$', 'PL-123')).toBe(true)
    expect(matchesRegex('^[()|a]+$', '(|a)')).toBe(true)
    expect(matchesRegex('^\\(test\\)$', '(test)')).toBe(true)
    expect(matchesRegex('(?:item-)+\\d+', 'item-item-42')).toBe(true)
    expect(matchesRegex('^order-\\d+$', 'no-match')).toBe(false)
  })

  it('returns false for invalid regex syntax', () => {
    expect(matchesRegex('(unclosed', 'test')).toBe(false)
  })

  it('non-regex operators still work normally', () => {
    expect(evaluateFilterConditions(
      [{ field: 'status', operator: 'eq', value: 'active' }],
      { status: 'active' },
    )).toBe(true)

    expect(evaluateFilterConditions(
      [{ field: 'count', operator: 'gt', value: 5 }],
      { count: 10 },
    )).toBe(true)
  })
})
