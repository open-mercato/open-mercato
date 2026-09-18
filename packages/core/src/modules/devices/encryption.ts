import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// `push_token` is a long-lived provider secret. It is never exposed via the API (only a last-8
// snapshot is persisted on delivery rows) and is redacted from audit-log snapshots, so it is
// encrypted at rest. Reads route through `findWithDecryption`/`findOneWithDecryption` per the
// `packages/core/AGENTS.md` Encryption section. No blind-index column is needed: the push delivery
// path looks devices up by id/user, never by token value.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'devices:user_device',
    fields: [{ field: 'push_token' }],
  },
]

export default defaultEncryptionMaps
