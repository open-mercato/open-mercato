import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { PasskeyProvider } from '../providers/PasskeyProvider'
import { defaultSecurityModuleConfig } from '../security-config'

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}))

const generateRegistrationOptionsMock = generateRegistrationOptions as jest.MockedFunction<typeof generateRegistrationOptions>
const verifyRegistrationResponseMock = verifyRegistrationResponse as jest.MockedFunction<typeof verifyRegistrationResponse>
const generateAuthenticationOptionsMock = generateAuthenticationOptions as jest.MockedFunction<typeof generateAuthenticationOptions>
const verifyAuthenticationResponseMock = verifyAuthenticationResponse as jest.MockedFunction<typeof verifyAuthenticationResponse>
const TEST_SETUP_TOKEN_SECRET = 'test-mfa-setup-secret'

describe('PasskeyProvider', () => {
  beforeEach(() => {
    jest.resetAllMocks()

    generateRegistrationOptionsMock.mockResolvedValue({
      challenge: 'setup-challenge',
      rp: {
        name: 'Open Mercato',
        id: 'localhost',
      },
      user: {
        id: 'user-1',
        name: 'user-1',
        displayName: 'MacBook Touch ID',
      },
      pubKeyCredParams: [],
    } as never)

    verifyRegistrationResponseMock.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-123',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
      },
    } as never)

    generateAuthenticationOptionsMock.mockResolvedValue({
      challenge: 'auth-challenge',
      rpId: 'localhost',
      allowCredentials: [{
        id: 'cred-123',
        type: 'public-key',
      }],
      timeout: 300000,
      userVerification: 'preferred',
    } as never)

    verifyAuthenticationResponseMock.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
      },
    } as never)
  })

  test('creates registration options and confirms metadata from webauthn response', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const setup = await provider.setup('user-1', { label: 'MacBook Touch ID' })

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, {
      response: {
        id: 'cred-123',
        rawId: 'cred-123',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
      },
    })

    expect(generateRegistrationOptionsMock).toHaveBeenCalled()
    expect(verifyRegistrationResponseMock).toHaveBeenCalled()
    expect(confirmation.metadata.credentialId).toBe('cred-123')
    expect(confirmation.metadata.credentialPublicKey).toBe('AQIDBA')
    expect(confirmation.metadata.counter).toBe(0)
  })

  test('uses the user email as the default WebAuthn user name and display name', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const resolvedPayload = provider.resolveSetupPayload?.(
      {
        id: 'user-1',
        email: 'owner@example.com',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {},
    )

    await provider.setup('user-1', resolvedPayload ?? {})

    expect(generateRegistrationOptionsMock).toHaveBeenCalledWith(expect.objectContaining({
      userName: 'owner@example.com',
      userDisplayName: 'owner@example.com',
    }))
  })

  test('uses configured RP name and ID for registration options', async () => {
    const provider = new PasskeyProvider({
      ...defaultSecurityModuleConfig,
      webauthn: {
        ...defaultSecurityModuleConfig.webauthn,
        rpName: 'Acme Mercato',
        rpId: 'login.acme.test',
        expectedOrigins: ['https://login.acme.test'],
      },
    }, TEST_SETUP_TOKEN_SECRET)

    await provider.setup('user-1', { label: 'YubiKey' })

    expect(generateRegistrationOptionsMock).toHaveBeenCalledWith(expect.objectContaining({
      rpName: 'Acme Mercato',
      rpID: 'login.acme.test',
    }))
  })

  test('uses the request host for WebAuthn on preview deployments', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const request = new Request('https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com/api/security/mfa/prepare')

    await provider.setup('user-1', { label: 'YubiKey' }, { request })

    expect(generateRegistrationOptionsMock).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com',
    }))
  })

  test('confirms setup across different provider instances', async () => {
    const setupProvider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const confirmProvider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const setup = await setupProvider.setup('user-1', { label: 'MacBook Touch ID' })

    const confirmation = await confirmProvider.confirmSetup('user-1', setup.setupId, {
      response: {
        id: 'cred-cross-instance',
        rawId: 'cred-cross-instance',
        type: 'public-key',
        response: {
          clientDataJSON: 'client-data',
          attestationObject: 'attestation',
        },
      },
    })

    expect(confirmation.metadata.credentialId).toBe('cred-123')
    expect(confirmation.metadata.credentialPublicKey).toBe('AQIDBA')
  })

  test('prepares and verifies passkey authentication challenge', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const request = new Request('https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com/api/security/mfa/prepare')
    const method = {
      id: 'method-1',
      userId: 'user-1',
      type: 'passkey',
      providerMetadata: {
        credentialId: 'cred-123',
        credentialPublicKey: 'AQIDBA',
        counter: 0,
        transports: ['internal'],
      },
    }

    const prepared = await provider.prepareChallenge('user-1', method, { request })
    expect(prepared.clientData?.challenge).toBe('auth-challenge')
    expect(prepared.verifyContext?.challenge).toMatchObject({
      challenge: 'auth-challenge',
    })

    const valid = await provider.verify('user-1', method, {
      response: {
        id: 'cred-123',
        rawId: 'cred-123',
        type: 'public-key',
        response: {
          authenticatorData: 'auth-data',
          clientDataJSON: 'client-data',
          signature: 'signature',
        },
      },
    }, prepared.verifyContext, { request })

    expect(valid).toBe(true)
    expect(generateAuthenticationOptionsMock).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com',
    }))
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedRPID: 'preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com',
      expectedOrigin: ['https://preview-ephemeralenvom-preview-0kyxui-wmfj8i.openmercato.com'],
    }))
    expect(verifyAuthenticationResponseMock).toHaveBeenCalled()
    expect(method.providerMetadata.counter).toBe(1)
  })

  test('supports legacy verification payload for backward compatibility', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const method = {
      id: 'method-legacy',
      userId: 'user-1',
      type: 'passkey',
      providerMetadata: {
        credentialId: 'cred-legacy',
        credentialPublicKey: 'AQIDBA',
      },
    }

    generateAuthenticationOptionsMock.mockResolvedValueOnce({
      challenge: 'legacy-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 300000,
      userVerification: 'preferred',
    } as never)

    await provider.prepareChallenge('user-1', method)
    const valid = await provider.verify('user-1', method, {
      credentialId: 'cred-legacy',
      challenge: 'legacy-challenge',
    })

    expect(valid).toBe(true)
  })
})
