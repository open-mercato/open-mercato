import { defaultEncryptionMaps } from '../../encryption'

describe('payment_gateways defaultEncryptionMaps', () => {
  it('registers an encryption map for the gateway_transaction entity', () => {
    expect(defaultEncryptionMaps).toHaveLength(1)
    const [entry] = defaultEncryptionMaps
    expect(entry.entityId).toBe('payment_gateways:gateway_transaction')
  })

  it('encrypts the sensitive client secret and provider payload fields', () => {
    const entry = defaultEncryptionMaps.find(
      (map) => map.entityId === 'payment_gateways:gateway_transaction',
    )
    expect(entry).toBeDefined()

    const byField = new Map(entry!.fields.map((field) => [field.field, field]))
    for (const field of ['client_secret', 'gateway_metadata', 'webhook_log']) {
      expect(byField.has(field)).toBe(true)
    }
    // None of these are lookup keys, so no deterministic hash should be declared.
    expect(byField.get('client_secret')?.hashField).toBeUndefined()
    expect(byField.get('gateway_metadata')?.hashField).toBeUndefined()
    expect(byField.get('webhook_log')?.hashField).toBeUndefined()
  })

  it('never encrypts lookup-critical columns used in WHERE filters', () => {
    const entry = defaultEncryptionMaps.find(
      (map) => map.entityId === 'payment_gateways:gateway_transaction',
    )
    expect(entry).toBeDefined()

    const encryptedFields = new Set(entry!.fields.map((field) => field.field))
    for (const lookupField of [
      'provider_key',
      'provider_session_id',
      'unified_status',
      'gateway_payment_id',
      'gateway_refund_id',
      'organization_id',
      'tenant_id',
    ]) {
      expect(encryptedFields.has(lookupField)).toBe(false)
    }
  })
})
