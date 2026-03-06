import { PasskeyProvider } from '../providers/PasskeyProvider'

describe('PasskeyProvider', () => {
  test('creates setup challenge and confirms registration metadata', async () => {
    const provider = new PasskeyProvider()
    const setup = await provider.setup('user-1', { label: 'MacBook Touch ID' })
    const challenge = String(setup.clientData.challenge)

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, {
      credentialId: 'cred-123',
      publicKey: 'public-key-abc',
      challenge,
      transports: ['internal'],
    })

    expect(confirmation.metadata.credentialId).toBe('cred-123')
    expect(confirmation.metadata.publicKey).toBe('public-key-abc')
  })

  test('prepares and verifies passkey challenge', async () => {
    const provider = new PasskeyProvider()
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'passkey',
      providerMetadata: {
        credentialId: 'cred-xyz',
        publicKey: 'public-key-xyz',
      },
    }

    const prepared = await provider.prepareChallenge('user-1', method)
    const challenge = String(prepared.clientData?.challenge)

    const valid = await provider.verify('user-1', method, {
      credentialId: 'cred-xyz',
      challenge,
    })
    const invalid = await provider.verify('user-1', method, {
      credentialId: 'cred-xyz',
      challenge: 'different-challenge',
    })

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })
})
