import { defaultEncryptionMaps } from '../encryption'

// Guard: push_token is a hard secret and MUST stay encrypted at rest. If this declaration is dropped
// or the field renamed, every device read silently stops decrypting (findWithDecryption becomes a
// no-op) and tokens would be written in plaintext — so pin the contract here.
describe('devices encryption map', () => {
  it('declares push_token as encrypted for devices:user_device', () => {
    const map = defaultEncryptionMaps.find((entry) => entry.entityId === 'devices:user_device')
    expect(map).toBeDefined()
    expect(map?.fields.map((field) => field.field)).toContain('push_token')
  })
})
