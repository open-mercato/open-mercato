import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * The communication_channels hub adds no new sensitive columns.
 * Credential encryption for `IntegrationCredentials.credentials` is owned by
 * the `integrations` module (see packages/core/src/modules/integrations/encryption.ts).
 * This export is intentionally empty for symmetry with other modules and to
 * provide a hook for future per-channel sensitive columns.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = []

export default defaultEncryptionMaps
