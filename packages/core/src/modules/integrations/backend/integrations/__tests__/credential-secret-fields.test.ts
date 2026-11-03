import type { IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'

import {
  buildCredentialEditValues,
  buildCredentialSavePayload,
  buildIntegrationCredentialSavePayload,
} from '../credential-secret-fields'

const fields: IntegrationCredentialField[] = [
  { key: 'clientId', label: 'Client ID', type: 'text' },
  { key: 'apiSecret', label: 'API Secret', type: 'secret' },
  { key: 'oauthTokens', label: 'OAuth Tokens', type: 'oauth' },
  { key: 'sshKey', label: 'SSH Key', type: 'ssh_keypair' },
]

describe('credential secret field form state', () => {
  it('removes configured secret transport values from editable values', () => {
    expect(buildCredentialEditValues(
      {
        clientId: 'client-123',
        apiSecret: '__masked__',
        oauthTokens: '__masked__',
        sshKey: '__masked__',
      },
      { apiSecret: true, oauthTokens: true, sshKey: true },
    )).toEqual({ clientId: 'client-123' })
  })

  it('lists untouched configured secrets while keeping replacements and non-secret values', () => {
    expect(buildCredentialSavePayload(
      { clientId: 'client-456', apiSecret: 'rotated-secret', oauthTokens: '' },
      fields,
      { apiSecret: true, oauthTokens: true, sshKey: true },
    )).toEqual({
      credentials: { clientId: 'client-456', apiSecret: 'rotated-secret' },
      unchangedSecretFields: ['oauthTokens', 'sshKey'],
    })
  })

  it('keeps unconfigured empty values as explicit submissions', () => {
    expect(buildCredentialSavePayload(
      { apiSecret: '' },
      fields,
      { apiSecret: false },
    )).toEqual({ credentials: { apiSecret: '' } })
  })

  it('omits deliberately cleared secrets without marking them unchanged', () => {
    expect(buildCredentialSavePayload(
      { clientId: 'client-123', apiSecret: '', oauthTokens: '' },
      fields,
      { apiSecret: true, oauthTokens: true },
      new Set(['apiSecret']),
    )).toEqual({
      credentials: { clientId: 'client-123' },
      unchangedSecretFields: ['oauthTokens'],
    })
  })

  it('keeps storage_s3 ambient mode as an explicit access-key clear', () => {
    const storageFields: IntegrationCredentialField[] = [
      { key: 'authMode', label: 'Authentication mode', type: 'select' },
      { key: 'accessKeyId', label: 'Access key ID', type: 'text' },
      { key: 'secretAccessKey', label: 'Secret access key', type: 'secret' },
      { key: 'sessionToken', label: 'Session token', type: 'secret' },
    ]

    expect(buildIntegrationCredentialSavePayload(
      'storage_s3',
      {
        authMode: 'ambient',
        accessKeyId: 'stored-access-key-id',
        secretAccessKey: '',
        sessionToken: '',
      },
      storageFields,
      { secretAccessKey: true, sessionToken: true },
    )).toEqual({ credentials: { authMode: 'ambient' } })
  })
})
