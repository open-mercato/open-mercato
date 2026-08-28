import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const SECURITY_MFA_METHOD_ENCRYPTION_ENTITY_ID = 'security:user_mfa_method'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: SECURITY_MFA_METHOD_ENCRYPTION_ENTITY_ID,
    fields: [{ field: 'secret', hashField: 'secret_hash' }],
  },
]

export default defaultEncryptionMaps
