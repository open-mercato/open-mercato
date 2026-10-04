import { buildUserDisplayNamesUrl, normalizeUserIds, toUserDisplayNames } from '../users/user-display-names'

describe('user display names', () => {
  it('deduplicates, trims, sorts and caps the requested ids', () => {
    expect(normalizeUserIds(['b', ' a ', 'b', '', null, undefined])).toEqual(['a', 'b'])
    expect(normalizeUserIds(Array.from({ length: 150 }, (_value, index) => `u-${String(index).padStart(3, '0')}`))).toHaveLength(100)
  })

  it('requests exactly the ids it needs from the users API', () => {
    expect(buildUserDisplayNamesUrl(['a', 'b'])).toBe('/api/auth/users?ids=a%2Cb&pageSize=2')
  })

  it('prefers the display name, falls back to the email and skips unusable rows', () => {
    expect(toUserDisplayNames([
      { id: 'a', name: 'Ada Admin', email: 'ada@acme.test' },
      { id: 'b', name: ' ', email: 'bob@acme.test' },
      { id: 'c', name: null, email: null },
      { name: 'No id' },
    ])).toEqual({ a: 'Ada Admin', b: 'bob@acme.test' })
  })
})
