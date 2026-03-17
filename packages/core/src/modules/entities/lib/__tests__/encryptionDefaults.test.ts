import { DEFAULT_ENCRYPTION_MAPS } from '../encryptionDefaults'

describe('DEFAULT_ENCRYPTION_MAPS', () => {
  it('encrypts payment gateway transaction secrets and pay-link metadata by default', () => {
    expect(DEFAULT_ENCRYPTION_MAPS).toEqual(expect.arrayContaining([
      {
        entityId: 'payment_gateways:gateway_transaction',
        fields: expect.arrayContaining([
          { field: 'provider_session_id' },
          { field: 'gateway_payment_id' },
          { field: 'gateway_refund_id' },
          { field: 'redirect_url' },
          { field: 'client_secret' },
          { field: 'gateway_metadata' },
          { field: 'webhook_log' },
        ]),
      },
      {
        entityId: 'payment_gateways:gateway_payment_link',
        fields: expect.arrayContaining([
          { field: 'title' },
          { field: 'description' },
          { field: 'password_hash' },
          { field: 'metadata' },
        ]),
      },
    ]))
  })
})
