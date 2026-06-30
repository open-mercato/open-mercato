/** @jest-environment node */

import type { IntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'

import {
  MASKED_SECRET_VALUE,
  maskSecretCredentials,
  mergeMaskedSecretCredentials,
} from '../credentials-masking'

const schema: IntegrationCredentialsSchema = {
  fields: [
    { key: 'apiUrl', label: 'API URL', type: 'url' },
    { key: 'clientId', label: 'Client ID', type: 'text' },
    { key: 'apiSecret', label: 'API Secret', type: 'secret' },
    { key: 'sshKey', label: 'SSH Key', type: 'ssh_keypair' },
  ],
}

describe('maskSecretCredentials', () => {
  it('replaces configured secret values with the sentinel and never returns plaintext', () => {
    const { credentials, secretFieldsConfigured } = maskSecretCredentials(schema, {
      apiUrl: 'https://example.com',
      clientId: 'client-123',
      apiSecret: 'super-secret-key',
      sshKey: { privateKey: 'PRIVATE', publicKey: 'PUBLIC' },
    })

    expect(credentials).toEqual({
      apiUrl: 'https://example.com',
      clientId: 'client-123',
      apiSecret: MASKED_SECRET_VALUE,
      sshKey: MASKED_SECRET_VALUE,
    })
    expect(JSON.stringify(credentials)).not.toContain('super-secret-key')
    expect(JSON.stringify(credentials)).not.toContain('PRIVATE')
    expect(secretFieldsConfigured).toEqual({ apiSecret: true, sshKey: true })
  })

  it('omits unconfigured secret fields and reports them as not configured', () => {
    const { credentials, secretFieldsConfigured } = maskSecretCredentials(schema, {
      clientId: 'client-123',
      apiSecret: '',
    })

    expect(credentials).toEqual({ clientId: 'client-123' })
    expect(credentials).not.toHaveProperty('apiSecret')
    expect(secretFieldsConfigured).toEqual({ apiSecret: false, sshKey: false })
  })

  it('passes through non-secret config when schema is undefined', () => {
    const { credentials, secretFieldsConfigured } = maskSecretCredentials(undefined, { foo: 'bar' })
    expect(credentials).toEqual({ foo: 'bar' })
    expect(secretFieldsConfigured).toEqual({})
  })
})

describe('mergeMaskedSecretCredentials', () => {
  it('preserves the existing secret when the client submits the sentinel unchanged', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { clientId: 'client-123', apiSecret: MASKED_SECRET_VALUE },
      { apiSecret: 'stored-secret' },
    )
    expect(merged).toEqual({ clientId: 'client-123', apiSecret: 'stored-secret' })
  })

  it('writes a new secret value when the client changes it', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiSecret: 'rotated-secret' },
      { apiSecret: 'stored-secret' },
    )
    expect(merged.apiSecret).toBe('rotated-secret')
  })

  it('clears the secret when the client submits an empty string', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiSecret: '' },
      { apiSecret: 'stored-secret' },
    )
    expect(merged.apiSecret).toBe('')
  })

  it('never persists the literal sentinel when nothing was stored before', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiSecret: MASKED_SECRET_VALUE },
      {},
    )
    expect(merged).not.toHaveProperty('apiSecret')
  })

  it('leaves non-secret fields untouched even if they equal the sentinel', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { clientId: MASKED_SECRET_VALUE },
      { clientId: 'stored-client' },
    )
    expect(merged.clientId).toBe(MASKED_SECRET_VALUE)
  })
})
