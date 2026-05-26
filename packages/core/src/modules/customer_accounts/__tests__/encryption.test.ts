import { defaultEncryptionMaps } from '../encryption'

describe('customer_accounts defaultEncryptionMaps', () => {
  it('encrypts customer_user PII (email + display name) with deterministic email_hash for lookup', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'customer_accounts:customer_user')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'email', hashField: 'email_hash' },
      { field: 'display_name' },
    ]))
  })

  it('encrypts session telemetry (ip address + user agent)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'customer_accounts:customer_user_session')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'ip_address' },
      { field: 'user_agent' },
    ]))
  })

  it('encrypts pending invitation PII (email + display name)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'customer_accounts:customer_user_invitation')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'email', hashField: 'email_hash' },
      { field: 'display_name' },
    ]))
  })
})
