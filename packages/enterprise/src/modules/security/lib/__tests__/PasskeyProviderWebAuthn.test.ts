import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { PasskeyProvider } from '../providers/PasskeyProvider'
import { defaultSecurityModuleConfig } from '../security-config'

const RP_ID = defaultSecurityModuleConfig.webauthn.rpId
const ORIGIN = defaultSecurityModuleConfig.webauthn.expectedOrigins[0]
const CREDENTIAL_ID = 'software-authenticator-credential'
const TEST_SETUP_TOKEN_SECRET = 'test-mfa-setup-secret'

type SoftwareAuthenticator = {
  cosePublicKey: string
  sign: (challenge: string, options?: { signCount?: number }) => {
    id: string
    rawId: string
    type: string
    clientExtensionResults: Record<string, never>
    response: {
      clientDataJSON: string
      authenticatorData: string
      signature: string
    }
  }
}

function encodeCosePublicKey(publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  return isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
  ]))
}

function buildAuthenticatorData(signCount: number): Buffer {
  const rpIdHash = createHash('sha256').update(RP_ID).digest()
  const flags = Buffer.from([0x05])
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(signCount, 0)
  return Buffer.concat([rpIdHash, flags, counter])
}

function createSoftwareAuthenticator(): SoftwareAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

  return {
    cosePublicKey: Buffer.from(encodeCosePublicKey(publicKey)).toString('base64url'),
    sign: (challenge, options = {}) => {
      const clientDataJSON = Buffer.from(JSON.stringify({
        type: 'webauthn.get',
        challenge,
        origin: ORIGIN,
        crossOrigin: false,
      }), 'utf8')
      const authenticatorData = buildAuthenticatorData(options.signCount ?? 1)
      const signedData = Buffer.concat([
        authenticatorData,
        createHash('sha256').update(clientDataJSON).digest(),
      ])
      const signature = createSign('sha256').update(signedData).sign(privateKey)

      return {
        id: CREDENTIAL_ID,
        rawId: CREDENTIAL_ID,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      }
    },
  }
}

describe('PasskeyProvider against a real WebAuthn authenticator', () => {
  const authenticator = createSoftwareAuthenticator()

  function createMethod() {
    return {
      id: 'method-1',
      userId: 'user-1',
      type: 'passkey',
      providerMetadata: {
        credentialId: CREDENTIAL_ID,
        credentialPublicKey: authenticator.cosePublicKey,
        counter: 0,
        transports: ['internal'],
      },
    }
  }

  test('accepts an assertion signed by the enrolled credential and advances the counter', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const method = createMethod()

    const prepared = await provider.prepareChallenge('user-1', method)
    const challenge = prepared.clientData?.challenge as string
    expect(typeof challenge).toBe('string')

    const verified = await provider.verify(
      'user-1',
      method,
      { response: authenticator.sign(challenge, { signCount: 7 }) },
      prepared.verifyContext,
    )

    expect(verified).toBe(true)
    expect(method.providerMetadata.counter).toBe(7)
  })

  test('rejects an assertion whose signature was tampered with', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const method = createMethod()

    const prepared = await provider.prepareChallenge('user-1', method)
    const assertion = authenticator.sign(prepared.clientData?.challenge as string)
    const forged = {
      ...assertion,
      response: {
        ...assertion.response,
        signature: Buffer.from('not-a-real-signature').toString('base64url'),
      },
    }

    const verified = await provider.verify('user-1', method, { response: forged }, prepared.verifyContext)

    expect(verified).toBe(false)
    expect(method.providerMetadata.counter).toBe(0)
  })

  test('rejects an assertion replayed against a different challenge', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const method = createMethod()

    const first = await provider.prepareChallenge('user-1', method)
    const second = await provider.prepareChallenge('user-1', method)
    const assertion = authenticator.sign(first.clientData?.challenge as string)

    const verified = await provider.verify('user-1', method, { response: assertion }, second.verifyContext)

    expect(verified).toBe(false)
  })

  test('rejects the disclosed credentialId and challenge instead of an assertion', async () => {
    const provider = new PasskeyProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const method = createMethod()

    const prepared = await provider.prepareChallenge('user-1', method)

    const verified = await provider.verify('user-1', method, {
      credentialId: CREDENTIAL_ID,
      challenge: prepared.clientData?.challenge,
    }, prepared.verifyContext)

    expect(verified).toBe(false)
  })
})
