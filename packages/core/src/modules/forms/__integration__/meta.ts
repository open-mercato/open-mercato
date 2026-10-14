/**
 * Forms integration-suite metadata.
 *
 * `dependsOnModules` is what makes CI's affected-only shard selection re-run
 * this suite when a module the specs lean on changes: `customer_accounts` for
 * the portal session helpers (`portalLogin`, `createCustomerUserFixture`) and
 * `attachments` for the storage-backed upload/PDF paths. Without the
 * declaration a change to either one leaves the forms suite unexercised.
 *
 * ENVIRONMENT PREREQUISITE — `FORMS_ENCRYPTION_MASTER_KEY`.
 * `resolveKmsAdapter` (services/encryption-service.ts) refuses the dev
 * deterministic KMS adapter when `NODE_ENV=production`, which is exactly how
 * the ephemeral lane runs the app. With the variable unset, every route that
 * resolves `formsEncryptionService` — the whole public runtime, the submission
 * inbox, analytics, export, attachments and PDF — throws during DI resolution
 * and answers a bare `500` with an empty body. Export a 32-byte hex/base64 key
 * for the app process (the runner inherits `process.env`) before running this
 * suite.
 */
export const integrationMeta = {
  description: 'Forms authoring, runtime, distribution, GDPR and portal flows',
  dependsOnModules: ['forms', 'customer_accounts', 'attachments'],
}

export default integrationMeta
