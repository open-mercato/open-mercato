import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { readGatewayMetadata, readWebhookLog } from '../transaction-fields'

const fixedKey = Buffer.alloc(32, 1).toString('base64')

type DecryptFieldsService = {
  decryptFields: (
    obj: Record<string, unknown>,
    fields: { field: string }[],
    dek: { key: string },
  ) => Record<string, unknown>
}

function makeDecryptService(): DecryptFieldsService {
  return new TenantDataEncryptionService({} as never) as unknown as DecryptFieldsService
}

// Mirrors TenantDataEncryptionService.encryptFields: strings stay raw, everything else is JSON-encoded.
function encryptField(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return encryptWithAesGcm(serialized, fixedKey).value as string
}

describe('readGatewayMetadata', () => {
  it('returns an empty object for null/undefined', () => {
    expect(readGatewayMetadata(null)).toEqual({})
    expect(readGatewayMetadata(undefined)).toEqual({})
  })

  it('passes a plain object through untouched (encryption disabled)', () => {
    const value = { clientSession: { type: 'redirect' } }
    expect(readGatewayMetadata(value)).toEqual(value)
  })

  it('parses a decrypted JSON-object string back to an object', () => {
    expect(readGatewayMetadata('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' })
  })

  it('falls back to an empty object for non-object decrypted values', () => {
    expect(readGatewayMetadata('not-json')).toEqual({})
    expect(readGatewayMetadata('[1,2,3]')).toEqual({})
  })
})

describe('readWebhookLog', () => {
  it('returns an empty array for null and non-array values', () => {
    expect(readWebhookLog(null)).toEqual([])
    expect(readWebhookLog('not-json')).toEqual([])
    expect(readWebhookLog('{"a":1}')).toEqual([])
  })

  it('passes an array through untouched (encryption disabled)', () => {
    const log = [
      { eventType: 'paid', receivedAt: 'now', idempotencyKey: 'k', unifiedStatus: 'captured', processed: true },
    ]
    expect(readWebhookLog(log)).toEqual(log)
  })

  it('parses a decrypted JSON-array string back to an array', () => {
    expect(readWebhookLog('[{"eventType":"paid"}]')).toEqual([{ eventType: 'paid' }])
  })
})

describe('encrypted gateway transaction fields survive the decryption round-trip', () => {
  it('restores client_secret, gateway_metadata, and webhook_log after encrypt + decrypt', () => {
    const service = makeDecryptService()
    const clientSecret = 'pi_secret_abc123'
    const gatewayMetadata = {
      clientSession: { type: 'redirect', redirectUrl: 'https://pay.example' },
      providerRef: 42,
    }
    const webhookLog = [
      {
        eventType: 'payment.authorized',
        receivedAt: '2026-06-19T00:00:00.000Z',
        idempotencyKey: 'evt_1',
        unifiedStatus: 'authorized',
        processed: true,
      },
    ]

    const stored = {
      client_secret: encryptField(clientSecret),
      gateway_metadata: encryptField(gatewayMetadata),
      webhook_log: encryptField(webhookLog),
    }

    const decrypted = service.decryptFields(
      stored,
      [{ field: 'client_secret' }, { field: 'gateway_metadata' }, { field: 'webhook_log' }],
      { key: fixedKey } as never,
    )

    // The existing decryption helper returns decrypted strings (entity fields are never auto-parsed).
    expect(decrypted.client_secret).toBe(clientSecret)
    expect(typeof decrypted.gateway_metadata).toBe('string')
    expect(typeof decrypted.webhook_log).toBe('string')

    // The module normalizers restore the structured shape consumers depend on.
    expect(readGatewayMetadata(decrypted.gateway_metadata)).toEqual(gatewayMetadata)
    expect(readWebhookLog(decrypted.webhook_log)).toEqual(webhookLog)
  })
})
