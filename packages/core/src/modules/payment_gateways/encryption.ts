import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// Gateway transactions persist provider secrets and raw provider payloads. Encrypt the client
// secret plus the JSONB columns that carry provider/session data and webhook history at rest.
// Lookup-critical columns (provider_key, provider_session_id, unified_status, gateway_payment_id,
// gateway_refund_id) are intentionally left in plaintext so status filters and session lookups keep
// working without a deterministic hash. The JSONB fields decrypt back to strings (entity fields are
// never auto-parsed — see issue #1810), so consumers MUST normalize them via lib/transaction-fields.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'payment_gateways:gateway_transaction',
    fields: [
      { field: 'client_secret' },
      { field: 'gateway_metadata' },
      { field: 'webhook_log' },
    ],
  },
]

export default defaultEncryptionMaps
