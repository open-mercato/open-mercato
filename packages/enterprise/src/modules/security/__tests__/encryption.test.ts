import { defaultEncryptionMaps, SECURITY_MFA_METHOD_ENCRYPTION_ENTITY_ID } from '../encryption'

describe('security encryption maps', () => {
  test('encrypts MFA secrets and keeps a deterministic setup lookup hash', () => {
    expect(defaultEncryptionMaps).toEqual([
      {
        entityId: SECURITY_MFA_METHOD_ENCRYPTION_ENTITY_ID,
        fields: [{ field: 'secret', hashField: 'secret_hash' }],
      },
    ])
  })
})
