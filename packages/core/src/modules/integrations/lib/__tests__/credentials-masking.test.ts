/** @jest-environment node */

import type { IntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'

import {
  MASKED_SECRET_VALUE,
  MaskedSecretDestinationChangedError,
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

  it('removes URL userinfo from legacy stored credentials', () => {
    const { credentials } = maskSecretCredentials(schema, {
      apiUrl: 'https://user:token@example.com/path?query=1',
    })

    expect(credentials.apiUrl).toBe('https://example.com/path?query=1')
    expect(JSON.stringify(credentials)).not.toContain('user')
    expect(JSON.stringify(credentials)).not.toContain('token')
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

  it('preserves only listed omitted secret fields', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiUrl: 'https://example.com' },
      {
        apiUrl: 'https://example.com',
        clientId: 'stored-client',
        apiSecret: 'stored-secret',
        sshKey: { privateKey: 'PRIVATE', publicKey: 'PUBLIC' },
      },
      ['clientId', 'apiSecret', 'sshKey', 'unknownSecret'],
    )

    expect(merged).toEqual({
      apiUrl: 'https://example.com',
      apiSecret: 'stored-secret',
      sshKey: { privateKey: 'PRIVATE', publicKey: 'PUBLIC' },
    })
  })

  it('keeps plain omission as full replacement behavior', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiUrl: 'https://example.com' },
      { apiSecret: 'stored-secret' },
    )

    expect(merged).toEqual({ apiUrl: 'https://example.com' })
  })

  it('lets an explicit replacement win over the unchanged list', () => {
    const merged = mergeMaskedSecretCredentials(
      schema,
      { apiSecret: 'rotated-secret' },
      { apiSecret: 'stored-secret' },
      ['apiSecret'],
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

  it('does not create a listed secret when nothing was stored before', () => {
    const merged = mergeMaskedSecretCredentials(schema, {}, {}, ['apiSecret'])
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


describe('masked secret destination binding (issue #9108)', () => {
  const destinationSchema: IntegrationCredentialsSchema = {
    fields: [
      ...schema.fields,
      { key: 'host', label: 'Host', type: 'text' },
      { key: 'port', label: 'Port', type: 'text' },
      { key: 'customDestination', label: 'Destination', type: 'url' },
      { key: 'oauthToken', label: 'OAuth token', type: 'oauth' },
    ],
  }
  const existing = {
    apiUrl: 'https://trusted.example',
    host: 'smtp.trusted.example',
    port: '587',
    customDestination: 'https://trusted.example/token',
    apiSecret: 'stored-secret',
    sshKey: { privateKey: 'PRIVATE', publicKey: 'PUBLIC' },
    oauthToken: 'stored-token',
  }

  it.each(['apiUrl', 'host', 'port', 'customDestination'])(
    'rejects a changed %s destination while preserving a masked secret', (field) => {
      expect(() => mergeMaskedSecretCredentials(destinationSchema, {
        ...existing, [field]: 'attacker.example', apiSecret: MASKED_SECRET_VALUE,
      }, existing)).toThrow(MaskedSecretDestinationChangedError)
    },
  )

  it.each(['apiUrl', 'host', 'port', 'customDestination'])(
    'rejects an omitted %s destination while preserving a listed secret', (field) => {
      const incoming: Record<string, unknown> = { ...existing }
      delete incoming[field]
      delete incoming.apiSecret
      expect(() => mergeMaskedSecretCredentials(destinationSchema, incoming, existing, ['apiSecret']))
        .toThrow(MaskedSecretDestinationChangedError)
    },
  )

  it('rejects a newly added destination when a stored secret had no destination', () => {
    expect(() => mergeMaskedSecretCredentials(schema,
      { apiUrl: 'https://attacker.example', apiSecret: MASKED_SECRET_VALUE },
      { apiSecret: 'stored-secret' },
    )).toThrow(MaskedSecretDestinationChangedError)
  })

  it.each(['host', 'port', 'api_url'])(
    'binds conventional %s destinations even when omitted from the schema', (field) => {
      expect(() => mergeMaskedSecretCredentials(schema,
        { [field]: 'attacker.example', apiSecret: MASKED_SECRET_VALUE },
        { [field]: 'trusted.example', apiSecret: 'stored-secret' },
      )).toThrow(MaskedSecretDestinationChangedError)
    },
  )

  it.each(['apiSecret', 'sshKey', 'oauthToken'])(
    'requires re-entry of retained %s secret types', (field) => {
      expect(() => mergeMaskedSecretCredentials(destinationSchema,
        { ...existing, host: 'attacker.example', [field]: MASKED_SECRET_VALUE }, existing,
      )).toThrow(MaskedSecretDestinationChangedError)
    },
  )

  it('preserves secrets for unrelated edits at the same destination', () => {
    expect(mergeMaskedSecretCredentials(destinationSchema,
      { ...existing, clientId: 'new-client', apiSecret: MASKED_SECRET_VALUE }, existing,
    )).toEqual({ ...existing, clientId: 'new-client' })
  })

  it('allows explicit replacement and clearing at a new destination', () => {
    expect(mergeMaskedSecretCredentials(destinationSchema, {
      host: 'new.example', apiSecret: 'new-secret', sshKey: '', oauthToken: null,
    }, existing, ['apiSecret', 'sshKey', 'oauthToken'])).toEqual({
      host: 'new.example', apiSecret: 'new-secret', sshKey: '', oauthToken: null,
    })
  })

  it('does not retain a secret when plain omission clears it at a new destination', () => {
    expect(mergeMaskedSecretCredentials(destinationSchema, { host: 'new.example' }, existing))
      .toEqual({ host: 'new.example' })
  })

  it('does not reject an unconfigured masked secret at a new destination', () => {
    expect(mergeMaskedSecretCredentials(destinationSchema,
      { host: 'new.example', apiSecret: MASKED_SECRET_VALUE }, {},
    )).toEqual({ host: 'new.example' })
  })

  it('reports field names without exposing stored secrets or submitted destinations', () => {
    expect.assertions(3)
    try {
      mergeMaskedSecretCredentials(destinationSchema, {
        ...existing, host: 'attacker.example', apiSecret: MASKED_SECRET_VALUE, oauthToken: MASKED_SECRET_VALUE,
      }, existing)
    } catch (error) {
      expect(error).toBeInstanceOf(MaskedSecretDestinationChangedError)
      expect((error as MaskedSecretDestinationChangedError).fields).toEqual(['apiSecret', 'oauthToken'])
      expect(String(error)).not.toMatch(/stored-secret|stored-token|attacker\.example/)
    }
  })
})
