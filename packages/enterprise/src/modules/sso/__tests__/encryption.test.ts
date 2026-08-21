import { defaultEncryptionMaps, SSO_CONFIG_ENCRYPTION_ENTITY_ID } from '../encryption'

describe('SSO encryption maps', () => {
  test('encrypts the OIDC client secret', () => {
    expect(defaultEncryptionMaps).toEqual([
      {
        entityId: SSO_CONFIG_ENCRYPTION_ENTITY_ID,
        fields: [{ field: 'client_secret_enc' }],
      },
    ])
  })
})
