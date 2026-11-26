// Preview for the planned KMS driver host. Copy this pattern to kms.ts after
// installing a release that supports it and the Vault driver package.
// OM_KMS_DRIVER=open-mercato/vault explicitly selects the package.

/*
import { defineKmsDriverRegistration } from '@open-mercato/shared/lib/encryption/kms-driver'

export const kmsDrivers = [
  defineKmsDriverRegistration({
    id: 'open-mercato/vault',
    edition: 'oss',
    load: () => import('@open-mercato/kms-driver-vault').then(({ kmsDriver }) => kmsDriver),
    settings: () => ({
      vaultAddr: process.env.VAULT_ADDR,
      vaultToken: process.env.VAULT_TOKEN,
      mountPath: process.env.VAULT_KV_PATH,
      requestTimeoutMs: process.env.VAULT_REQUEST_TIMEOUT_MS,
      recoveryCooldownMs: process.env.VAULT_RECOVERY_COOLDOWN_MS,
    }),
  }),
]
*/
