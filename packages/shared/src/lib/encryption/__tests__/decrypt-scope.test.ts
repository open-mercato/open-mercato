import {
  DecryptRefusalTally,
  resolveDecryptEnabled,
  resolveDecryptScope,
} from '../decryptScope'

describe('resolveDecryptScope', () => {
  test('decrypts when the row tenant matches the caller tenant', () => {
    const decision = resolveDecryptScope({
      rowTenantId: 't1',
      rowOrganizationId: 'org1',
      callerTenantId: 't1',
      callerOrganizationId: 'org9',
    })
    expect(decision).toEqual({ decrypt: true, tenantId: 't1', organizationId: 'org1' })
  })

  test('refuses when the row tenant contradicts the caller tenant', () => {
    const decision = resolveDecryptScope({
      rowTenantId: 't2',
      rowOrganizationId: 'org1',
      callerTenantId: 't1',
      callerOrganizationId: 'org1',
    })
    expect(decision).toEqual({
      decrypt: false,
      reason: 'tenant-mismatch',
      rowTenantId: 't2',
      callerTenantId: 't1',
    })
  })

  test('falls back to the caller scope when the row carries no tenant', () => {
    const decision = resolveDecryptScope({
      rowTenantId: null,
      rowOrganizationId: null,
      callerTenantId: 't1',
      callerOrganizationId: 'org1',
    })
    expect(decision).toEqual({ decrypt: true, tenantId: 't1', organizationId: 'org1' })
  })

  test('keeps the row tenant for a deliberate cross-tenant read that asserts no caller tenant', () => {
    const decision = resolveDecryptScope({
      rowTenantId: 't2',
      rowOrganizationId: 'org2',
      callerTenantId: null,
      callerOrganizationId: null,
    })
    expect(decision).toEqual({ decrypt: true, tenantId: 't2', organizationId: 'org2' })
  })

  test('resolves a null scope when neither side carries ids', () => {
    const decision = resolveDecryptScope({})
    expect(decision).toEqual({ decrypt: true, tenantId: null, organizationId: null })
  })

  test('never refuses on an organization mismatch alone', () => {
    const decision = resolveDecryptScope({
      rowTenantId: 't1',
      rowOrganizationId: 'org2',
      callerTenantId: 't1',
      callerOrganizationId: 'org1',
    })
    expect(decision).toEqual({ decrypt: true, tenantId: 't1', organizationId: 'org2' })
  })

  test('prefers the row organization and falls back to the caller organization', () => {
    expect(resolveDecryptScope({ rowTenantId: 't1', callerTenantId: 't1', callerOrganizationId: 'org1' }))
      .toEqual({ decrypt: true, tenantId: 't1', organizationId: 'org1' })
  })
})

describe('resolveDecryptEnabled', () => {
  test('defaults to decrypting, so existing callers are unaffected', () => {
    expect(resolveDecryptEnabled({})).toBe(true)
    expect(resolveDecryptEnabled({ decryptEncryptedFields: undefined })).toBe(true)
  })

  test('only an explicit false declines decryption', () => {
    expect(resolveDecryptEnabled({ decryptEncryptedFields: false })).toBe(false)
    expect(resolveDecryptEnabled({ decryptEncryptedFields: true })).toBe(true)
  })
})

describe('DecryptRefusalTally', () => {
  const refusal = (rowTenantId: string, callerTenantId = 't1') =>
    ({ decrypt: false, reason: 'tenant-mismatch', rowTenantId, callerTenantId }) as const

  test('starts empty', () => {
    expect(new DecryptRefusalTally().refused).toBe(0)
  })

  test('counts every refusal but samples a bounded set of row tenant ids', () => {
    const tally = new DecryptRefusalTally()
    for (const tenant of ['t2', 't3', 't4', 't5', 't6']) tally.record(refusal(tenant))
    expect(tally.refused).toBe(5)
    const context = tally.toLogContext('customers:customer')
    expect(context.refusedRows).toBe(5)
    expect(context.callerTenantId).toBe('t1')
    expect(context.rowTenantIds).toEqual(['t2', 't3', 't4'])
  })

  test('log context carries ids only — never row values', () => {
    const tally = new DecryptRefusalTally()
    tally.record(refusal('t2'))
    expect(Object.keys(tally.toLogContext('customers:customer')).sort()).toEqual([
      'callerTenantId',
      'entity',
      'refusedRows',
      'rowTenantIds',
    ])
  })
})
