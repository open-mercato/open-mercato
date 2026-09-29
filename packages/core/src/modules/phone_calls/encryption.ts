import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'phone_calls:phone_call',
    fields: [
      // raw_snapshot and provider_facts hold the untouched Tillio payload, which
      // carries caller/destination numbers (PII) that we already encrypt on the
      // participant. recording_url points at the call recording. QueryEngine
      // decrypts these transparently on read.
      { field: 'raw_snapshot' },
      { field: 'provider_facts' },
      { field: 'recording_url' },
    ],
  },
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
