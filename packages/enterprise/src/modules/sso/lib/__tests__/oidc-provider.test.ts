jest.mock('openid-client', () => ({}))

import { extractIdentityGroups, coerceClaimValues } from '../oidc-provider'

describe('coerceClaimValues', () => {
  test('returns empty array for null', () => {
    expect(coerceClaimValues(null)).toEqual([])
  })

  test('returns empty array for undefined', () => {
    expect(coerceClaimValues(undefined)).toEqual([])
  })

  test('returns empty array for number', () => {
    expect(coerceClaimValues(42)).toEqual([])
  })

  test('returns empty array for boolean', () => {
    expect(coerceClaimValues(true)).toEqual([])
  })

  test('wraps a non-empty string in an array', () => {
    expect(coerceClaimValues('admin')).toEqual(['admin'])
  })

  test('trims whitespace from string values', () => {
    expect(coerceClaimValues('  admin  ')).toEqual(['admin'])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(coerceClaimValues('   ')).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(coerceClaimValues('')).toEqual([])
  })

  test('flattens a simple string array', () => {
    expect(coerceClaimValues(['admin', 'editor'])).toEqual(['admin', 'editor'])
  })

  test('flattens nested arrays recursively', () => {
    expect(coerceClaimValues([['admin'], [['editor', 'viewer']]])).toEqual([
      'admin',
      'editor',
      'viewer',
    ])
  })

  test('filters out non-string entries from arrays', () => {
    expect(coerceClaimValues(['admin', 42, null, 'editor'])).toEqual(['admin', 'editor'])
  })

  test('extracts keys and string values from objects', () => {
    const result = coerceClaimValues({ groupA: 'Admin', groupB: 'Editor' })
    expect(result).toContain('groupA')
    expect(result).toContain('Admin')
    expect(result).toContain('groupB')
    expect(result).toContain('Editor')
  })

  test('extracts only keys when values are non-string', () => {
    const result = coerceClaimValues({ groupA: 123, groupB: true })
    expect(result).toEqual(['groupA', 'groupB'])
  })

  test('extracts name property from nested objects', () => {
    const result = coerceClaimValues({
      '001': { name: 'Administrators' },
      '002': { name: 'Editors' },
    })
    expect(result).toContain('001')
    expect(result).toContain('Administrators')
    expect(result).toContain('002')
    expect(result).toContain('Editors')
  })

  test('ignores nested objects without a name property', () => {
    const result = coerceClaimValues({ '001': { id: 'abc' } })
    expect(result).toEqual(['001'])
  })

  test('trims keys and nested name values', () => {
    const result = coerceClaimValues({ ' key ': { name: ' value ' } })
    expect(result).toContain('key')
    expect(result).toContain('value')
  })

  test('skips empty keys after trimming', () => {
    const result = coerceClaimValues({ '  ': 'admin' })
    expect(result).toContain('admin')
    expect(result).not.toContain('')
  })
})

describe('extractIdentityGroups', () => {
  test('returns undefined when no group claims are present', () => {
    expect(extractIdentityGroups({ sub: '123', email: 'a@b.com' })).toBeUndefined()
  })

  test('returns undefined for empty claims', () => {
    expect(extractIdentityGroups({})).toBeUndefined()
  })

  test('extracts groups from "groups" claim (array of strings)', () => {
    const result = extractIdentityGroups({ groups: ['admin', 'viewer'] })
    expect(result).toEqual(['admin', 'viewer'])
  })

  test('extracts groups from "roles" claim', () => {
    const result = extractIdentityGroups({ roles: ['manager'] })
    expect(result).toEqual(['manager'])
  })

  test('extracts groups from "role" claim (singular string)', () => {
    const result = extractIdentityGroups({ role: 'superadmin' })
    expect(result).toEqual(['superadmin'])
  })

  test('extracts groups from keys ending with ":roles"', () => {
    const result = extractIdentityGroups({
      'http://schemas.example.com/ws/2024:roles': ['custom-role'],
    })
    expect(result).toEqual(['custom-role'])
  })

  test('ignores keys that contain but do not end with ":roles"', () => {
    const result = extractIdentityGroups({
      ':roles:extra': ['should-ignore'],
    })
    expect(result).toBeUndefined()
  })

  test('deduplicates groups across multiple claims', () => {
    const result = extractIdentityGroups({
      groups: ['admin', 'editor'],
      roles: ['admin', 'viewer'],
      role: 'editor',
    })
    expect(result).toBeDefined()
    expect(new Set(result)).toEqual(new Set(['admin', 'editor', 'viewer']))
    expect(result!.length).toBe(3)
  })

  test('handles object-type claims with name property', () => {
    const result = extractIdentityGroups({
      groups: { '001': { name: 'Admins' } },
    })
    expect(result).toContain('001')
    expect(result).toContain('Admins')
  })

  test('handles mixed types across claims', () => {
    const result = extractIdentityGroups({
      groups: ['group-a'],
      roles: 'single-role',
      'custom:roles': { id1: 'RoleName' },
    })
    expect(result).toBeDefined()
    expect(result).toContain('group-a')
    expect(result).toContain('single-role')
    expect(result).toContain('id1')
    expect(result).toContain('RoleName')
  })

  test('returns undefined when all group claims resolve to empty', () => {
    const result = extractIdentityGroups({
      groups: [],
      roles: [],
      role: '',
    })
    expect(result).toBeUndefined()
  })

  test('handles groups claim as a single string', () => {
    const result = extractIdentityGroups({ groups: 'solo-group' })
    expect(result).toEqual(['solo-group'])
  })
})
