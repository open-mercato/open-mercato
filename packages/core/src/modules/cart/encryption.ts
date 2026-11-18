import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    // §4.1: guest identification (email) and buyer-supplied free text (note) are
    // GDPR-sensitive. `configuration` on CartLine stays plaintext because
    // encrypting it would break the stored `configuration_hash` generated column.
    entityId: 'cart:cart',
    fields: [
      { field: 'email' },
      { field: 'note' },
    ],
  },
]

export default defaultEncryptionMaps
