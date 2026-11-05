import { parseScimFilter, scimFilterToWhere } from '../scim-filter'

describe('parseScimFilter', () => {
  test('returns empty array for null', () => {
    expect(parseScimFilter(null)).toEqual([])
  })

  test('returns empty array for undefined', () => {
    expect(parseScimFilter(undefined)).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(parseScimFilter('')).toEqual([])
    expect(parseScimFilter('   ')).toEqual([])
  })

  test('parses single eq condition', () => {
    const result = parseScimFilter('userName eq "john"')
    expect(result).toEqual([{ attribute: 'username', value: 'john' }])
  })

  test('parses and combinator', () => {
    const result = parseScimFilter('userName eq "john" and externalId eq "123"')
    expect(result).toEqual([
      { attribute: 'username', value: 'john' },
      { attribute: 'externalid', value: '123' },
    ])
  })

  test('is case-insensitive for eq and and', () => {
    const result = parseScimFilter('UserName EQ "john" AND ExternalId EQ "123"')
    expect(result).toEqual([
      { attribute: 'username', value: 'john' },
      { attribute: 'externalid', value: '123' },
    ])
  })

  test('normalizes attribute names to lowercase', () => {
    const result = parseScimFilter('DisplayName eq "Test"')
    expect(result).toEqual([{ attribute: 'displayname', value: 'Test' }])
  })

  test('ignores unsupported attributes', () => {
    const result = parseScimFilter('emails.value eq "test@example.com"')
    expect(result).toEqual([])
  })

  test('ignores malformed conditions', () => {
    expect(parseScimFilter('userName eq john')).toEqual([])
    expect(parseScimFilter('userName ne "john"')).toEqual([])
    expect(parseScimFilter('eq "john"')).toEqual([])
  })

  test('handles active eq "true"', () => {
    const result = parseScimFilter('active eq "true"')
    expect(result).toEqual([{ attribute: 'active', value: 'true' }])
  })

  test('handles active eq "false"', () => {
    const result = parseScimFilter('active eq "false"')
    expect(result).toEqual([{ attribute: 'active', value: 'false' }])
  })

  test('handles displayName eq with spaces in value', () => {
    const result = parseScimFilter('displayName eq "Some Name"')
    expect(result).toEqual([{ attribute: 'displayname', value: 'Some Name' }])
  })
})

describe('scimFilterToWhere', () => {
  const ssoConfigId = 'sso-config-1'
  const organizationId = 'org-1'

  test('returns base where clause with ssoConfigId, organizationId, deletedAt', () => {
    const result = scimFilterToWhere([], ssoConfigId, organizationId)
    expect(result).toEqual({
      ssoConfigId,
      organizationId,
      deletedAt: null,
    })
  })

  test('maps username to idpEmail', () => {
    const conditions = [{ attribute: 'username', value: 'john@example.com' }]
    const result = scimFilterToWhere(conditions, ssoConfigId, organizationId)
    expect(result.idpEmail).toBe('john@example.com')
  })

  test('maps externalid to externalId', () => {
    const conditions = [{ attribute: 'externalid', value: 'ext-123' }]
    const result = scimFilterToWhere(conditions, ssoConfigId, organizationId)
    expect(result.externalId).toBe('ext-123')
  })

  test('maps displayname to idpName', () => {
    const conditions = [{ attribute: 'displayname', value: 'John Doe' }]
    const result = scimFilterToWhere(conditions, ssoConfigId, organizationId)
    expect(result.idpName).toBe('John Doe')
  })

  test('ignores active attribute', () => {
    const conditions = [{ attribute: 'active', value: 'true' }]
    const result = scimFilterToWhere(conditions, ssoConfigId, organizationId)
    expect(result).toEqual({
      ssoConfigId,
      organizationId,
      deletedAt: null,
    })
  })
})
