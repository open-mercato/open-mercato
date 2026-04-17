import { defaultEncryptionMaps } from '../../encryption'

describe('messages defaultEncryptionMaps', () => {
  it('defers message PII encryption until the list API can decrypt raw Knex rows', () => {
    // The messages list endpoint fetches rows with raw Knex and applies SQL
    // ILIKE filters on subject/body/external_email, so registering an
    // encryption map for messages:message would break inbox search and list
    // rendering. Re-enable once the list API is migrated to MikroORM or gains
    // per-field hash lookups (tracked alongside the encryption hardening work
    // in issue #1413).
    expect(defaultEncryptionMaps).toEqual([])
  })
})
