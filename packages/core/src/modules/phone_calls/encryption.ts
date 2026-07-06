import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'phone_calls:phone_call_participant',
    fields: [
      { field: 'phone_number' },
      { field: 'display_name' },
      { field: 'email' },
    ],
  },
]

export default defaultEncryptionMaps
