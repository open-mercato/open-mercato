// Preview of the KMS driver registration contract. Activate this pattern in
// kms.ts once the installed host and provider package support it.
// At runtime use OM_KMS_DRIVER=example/key-store.

/*
import { defineKmsDriverRegistration } from '@open-mercato/shared/lib/encryption/kms-driver'

export const kmsDrivers = [
  defineKmsDriverRegistration({
    id: 'example/key-store',
    edition: 'oss',
    load: () => import('@example/mercato-kms-driver').then(({ kmsDriver }) => kmsDriver),
    settings: () => ({ namespace: process.env.EXAMPLE_KEY_STORE_NAMESPACE }),
  }),
]
*/
