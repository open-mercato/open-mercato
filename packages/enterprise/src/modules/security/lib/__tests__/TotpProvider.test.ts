import { createHmac } from 'node:crypto'
import QRCode from 'qrcode'
import { TotpProvider } from '../providers/TotpProvider'
import { defaultSecurityModuleConfig } from '../security-config'

jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn(),
  },
}))

const qrCodeToDataUrlMock = QRCode.toDataURL as jest.MockedFunction<typeof QRCode.toDataURL>

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TEST_SETUP_TOKEN_SECRET = 'test-mfa-setup-secret'

function decodeBase32(input: string): Buffer {
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const char of input.trim().replaceAll(' ', '').replaceAll('-', '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error('Invalid base32 character in test secret')
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

function generateTotp(secret: string, nowEpochSeconds: number): string {
  const counter = Math.floor(nowEpochSeconds / TOTP_PERIOD_SECONDS)
  const key = decodeBase32(secret)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

describe('TotpProvider', () => {
  const fixedEpochMs = Date.UTC(2026, 1, 17, 12, 0, 0)

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(fixedEpochMs)
    qrCodeToDataUrlMock.mockResolvedValue('data:image/png;base64,totp-qr')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('advertises authenticator app as a single-instance MFA provider', () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)

    expect(provider.allowMultiple).toBe(false)
  })

  test('creates setup and confirms with valid TOTP code', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const setup = await provider.setup('user-1', { issuer: 'Open Mercato', label: 'test-user' })
    const secret = String(setup.clientData.secret)
    const code = generateTotp(secret, Math.floor(fixedEpochMs / 1000))

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, { code })
    expect(confirmation.metadata).toEqual({})
    expect(confirmation.secret).toBe(secret)
  })

  test('verifies challenge codes against stored method metadata', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const setup = await provider.setup('user-1', {})
    const secret = String(setup.clientData.secret)
    const code = generateTotp(secret, Math.floor(fixedEpochMs / 1000))
    const confirmation = await provider.confirmSetup('user-1', setup.setupId, { code })

    const valid = await provider.verify(
      'user-1',
      {
        id: 'method-1',
        userId: 'user-1',
        type: 'totp',
        secret: confirmation.secret,
        providerMetadata: confirmation.metadata,
      },
      { code },
    )
    const invalid = await provider.verify(
      'user-1',
      {
        id: 'method-1',
        userId: 'user-1',
        type: 'totp',
        secret: confirmation.secret,
        providerMetadata: confirmation.metadata,
      },
      { code: '000000' },
    )

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })

  test('verifies legacy methods that still keep the TOTP secret in provider metadata', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const setup = await provider.setup('user-1', {})
    const secret = String(setup.clientData.secret)
    const code = generateTotp(secret, Math.floor(fixedEpochMs / 1000))

    const valid = await provider.verify(
      'user-1',
      {
        id: 'method-legacy',
        userId: 'user-1',
        type: 'totp',
        providerMetadata: { secret },
      },
      { code },
    )

    expect(valid).toBe(true)
  })

  test('uses the user email as the default authenticator label when available', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, TEST_SETUP_TOKEN_SECRET)
    const resolvedPayload = provider.resolveSetupPayload?.(
      {
        id: 'user-1',
        email: 'owner@example.com',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {},
    )

    const setup = await provider.setup('user-1', resolvedPayload ?? {})

    expect(setup.clientData.label).toBe('owner@example.com')
  })

  test('uses the configured issuer when the setup payload omits it', async () => {
    const provider = new TotpProvider({
      ...defaultSecurityModuleConfig,
      totp: {
        ...defaultSecurityModuleConfig.totp,
        issuer: 'Acme Security',
      },
    }, TEST_SETUP_TOKEN_SECRET)

    const setup = await provider.setup('user-1', {})

    expect(setup.clientData.issuer).toBe('Acme Security')
  })
})
