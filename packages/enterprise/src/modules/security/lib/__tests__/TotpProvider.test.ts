import { createHmac } from 'node:crypto'
import { TotpProvider } from '../providers/TotpProvider'

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6

function generateTotp(secret: string, nowEpochSeconds: number): string {
  const counter = Math.floor(nowEpochSeconds / TOTP_PERIOD_SECONDS)
  const key = Buffer.from(secret, 'base64')
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
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('creates setup and confirms with valid TOTP code', async () => {
    const provider = new TotpProvider()
    const setup = await provider.setup('user-1', { issuer: 'Open Mercato', label: 'test-user' })
    const secret = String(setup.clientData.secret)
    const code = generateTotp(secret, Math.floor(fixedEpochMs / 1000))

    const confirmation = await provider.confirmSetup('user-1', setup.setupId, { code })
    expect(confirmation.metadata.secret).toBe(secret)
    expect(confirmation.metadata.period).toBe(30)
  })

  test('verifies challenge codes against stored method metadata', async () => {
    const provider = new TotpProvider()
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
        providerMetadata: confirmation.metadata,
      },
      { code: '000000' },
    )

    expect(valid).toBe(true)
    expect(invalid).toBe(false)
  })
})
