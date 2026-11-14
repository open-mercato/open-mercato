import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const SSO_CONFIG_ENCRYPTION_ENTITY_ID = 'sso:sso_config'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: SSO_CONFIG_ENCRYPTION_ENTITY_ID,
    fields: [{ field: 'client_secret_enc' }],
  },
]

export default defaultEncryptionMaps
