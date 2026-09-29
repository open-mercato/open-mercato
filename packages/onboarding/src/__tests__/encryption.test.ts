import { defaultEncryptionMaps } from '../modules/onboarding/encryption'

describe('onboarding encryption map', () => {
  it('protects pre-tenant PII and the transient password hash with a system key', () => {
    expect(defaultEncryptionMaps).toEqual([
      {
        entityId: 'onboarding:onboarding_request',
        keyScope: 'system',
        fields: [
          { field: 'email', hashField: 'email_hash' },
          { field: 'first_name' },
          { field: 'last_name' },
          { field: 'organization_name' },
          { field: 'password_hash' },
        ],
      },
    ])
  })
})
