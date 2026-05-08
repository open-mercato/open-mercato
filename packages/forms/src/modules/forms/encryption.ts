import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Forms module encryption-defaults declarations.
 *
 * IMPORTANT: the `data` column on `forms_form_submission_revision` is NOT
 * routed through the global `findWithDecryption` pipeline — it is encrypted
 * directly by `EncryptionService` (see `services/encryption-service.ts`)
 * with per-tenant envelope encryption and a self-describing ciphertext
 * header carrying the key version.
 *
 * The export here exists so any future submission-side fields that ARE
 * suitable for the global pipeline (e.g. `submit_metadata`, `change_summary`)
 * can be declared in additive fashion without rewiring; phase 1c does not
 * route any column through the global pipeline.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = []

export default defaultEncryptionMaps
