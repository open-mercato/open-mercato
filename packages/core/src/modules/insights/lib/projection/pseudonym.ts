import { createHmac, hkdfSync } from 'node:crypto'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

export const TENANT_KEY_PSEUDONYM_PREFIX = 'tk1:'
export const ERASED_PSEUDONYM_PREFIX = 'erased:'
export const NO_PSEUDONYM_KEY_FINGERPRINT = 'none'

const PSEUDONYM_PURPOSE = 'open-mercato:insights-xray-actor:v1'
const KEY_CHECK_MESSAGE = 'open-mercato:insights-xray-key-check:v1'
const KEYED_LOOKUP_PREFIX = 'v2:'
const LOOKUP_KEY_FINGERPRINT_PREFIX = 'lk1:'
const DERIVED_KEY_BYTES = 32
const FINGERPRINT_HEX_LENGTH = 32

export type PseudonymKeySource = Pick<TenantDataEncryptionService, 'isEnabled' | 'getDek' | 'createDek'>

export type PseudonymMode = 'tenant_key' | 'lookup_pepper' | 'none'

export type ActorPseudonymizer = {
  mode: PseudonymMode
  fingerprint: string
  pseudonymize: (userId: string) => string | null
}

export type PseudonymKeyCompatibility = 'match' | 'adopt' | 'mismatch'

export class XrayPseudonymKeyUnavailableError extends Error {
  constructor() {
    super('[internal] The tenant key for Process X-Ray actor pseudonyms is unavailable')
    this.name = 'XrayPseudonymKeyUnavailableError'
  }
}

function lookupContext(tenantId: string): string {
  return `insights.xray.actor:${tenantId}`
}

function deriveTenantKey(tenantId: string, dekBase64: string): Buffer {
  const material = Buffer.from(dekBase64, 'base64')
  return Buffer.from(hkdfSync('sha256', material, Buffer.from(tenantId, 'utf8'), Buffer.from(PSEUDONYM_PURPOSE, 'utf8'), DERIVED_KEY_BYTES))
}

function tenantKeyPseudonymizer(tenantId: string, tenantKey: Buffer): ActorPseudonymizer {
  const fingerprint = createHmac('sha256', tenantKey).update(KEY_CHECK_MESSAGE).digest('hex').slice(0, FINGERPRINT_HEX_LENGTH)
  return {
    mode: 'tenant_key',
    fingerprint: `${TENANT_KEY_PSEUDONYM_PREFIX}${fingerprint}`,
    pseudonymize: (userId) => `${TENANT_KEY_PSEUDONYM_PREFIX}${createHmac('sha256', tenantKey).update(`${tenantId}:${userId.toLowerCase()}`).digest('hex')}`,
  }
}

/**
 * Builds the actor pseudonymizer of one tenant. Never produces an unkeyed digest.
 *
 * - Tenant data encryption on: an HMAC-SHA-256 (`tk1:`) under a purpose-bound key derived
 *   (HKDF) from the tenant's data key held by `TenantDataEncryptionService` (created when the
 *   tenant has none yet). An unhealthy KMS or a missing key throws
 *   `XrayPseudonymKeyUnavailableError`, so the caller fails and retries instead of writing a
 *   pseudonym under another key.
 * - Encryption off: the platform's keyed lookup hash (`v2:`, installation pepper), bound to
 *   the tenant through its context.
 * - Encryption off and no pepper: no pseudonyms at all (`pseudonymize` returns null).
 *
 * `fingerprint` identifies the key (never the key itself) so ingest can refuse to mix rows
 * written under different keys.
 */
export async function createActorPseudonymizer(
  tenantId: string,
  keySource: PseudonymKeySource | null,
): Promise<ActorPseudonymizer> {
  if (isTenantDataEncryptionEnabled()) {
    if (!keySource || !keySource.isEnabled()) throw new XrayPseudonymKeyUnavailableError()
    const dek = (await keySource.getDek(tenantId)) ?? (await keySource.createDek(tenantId))
    if (!dek?.key) throw new XrayPseudonymKeyUnavailableError()
    return tenantKeyPseudonymizer(tenantId, deriveTenantKey(tenantId, dek.key))
  }
  const context = lookupContext(tenantId)
  const probe = hashForLookup(KEY_CHECK_MESSAGE, context)
  if (!probe.startsWith(KEYED_LOOKUP_PREFIX)) {
    return { mode: 'none', fingerprint: NO_PSEUDONYM_KEY_FINGERPRINT, pseudonymize: () => null }
  }
  return {
    mode: 'lookup_pepper',
    fingerprint: `${LOOKUP_KEY_FINGERPRINT_PREFIX}${probe.slice(KEYED_LOOKUP_PREFIX.length, KEYED_LOOKUP_PREFIX.length + FINGERPRINT_HEX_LENGTH)}`,
    pseudonymize: (userId) => hashForLookup(userId.toLowerCase(), context),
  }
}

/**
 * Whether rows already written under `stored` may be continued under `current`: the same
 * key matches; a cursor without rows under any key (`null`, or `none` where no pseudonym was
 * ever written) adopts the current key; any other change is a mismatch.
 */
export function comparePseudonymKeys(stored: string | null, current: string): PseudonymKeyCompatibility {
  if (stored === current) return 'match'
  if (stored === null || stored === NO_PSEUDONYM_KEY_FINGERPRINT) return 'adopt'
  return 'mismatch'
}
