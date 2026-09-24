import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'ledger:journal_entry_line',
    fields: [{ field: 'contractor_snapshot' }],
  },
]

export default defaultEncryptionMaps
