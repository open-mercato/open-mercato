import { defaultEncryptionMaps } from '../encryption'

describe('auth defaultEncryptionMaps', () => {
  it('encrypts user email with deterministic email_hash for lookup', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'auth:user')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'email', hashField: 'email_hash' },
    ]))
  })

  it('encrypts user display name (PII alongside email)', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'auth:user')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'name' },
    ]))
  })

  it('encrypts user_consent ip_address and source', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'auth:user_consent')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'ip_address' },
      { field: 'source' },
    ]))
  })
})
