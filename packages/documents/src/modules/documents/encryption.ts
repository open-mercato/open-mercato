// Documents intentionally store CRDT state, rendered content, searchable text,
// comments, and snapshots as plaintext at rest because server-side CRDT merge
// and full-text search require plaintext materialization; confidentiality is
// enforced through tenant/org scope plus per-document access control.
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'documents:document_entity_link',
    fields: [{ field: 'label_snapshot' }],
  },
]

export default defaultEncryptionMaps
