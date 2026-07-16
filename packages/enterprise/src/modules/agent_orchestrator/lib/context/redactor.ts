import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import type { ContextRedactionApplied } from '../../data/validators'

/**
 * Least-privilege redactor (context overlay, Phase 4).
 *
 * Strips field-encrypted + PII values out of every source record BEFORE it
 * becomes a pack candidate, so an encrypted/PII value can NEVER appear in the
 * agent-visible packed payload. Two redaction rules are applied, in order:
 *
 *   1. `field_encryption` — fields the tenant's encryption map (or the module's
 *      static `defaultEncryptionMaps`) marks as encrypted at rest. These are
 *      decrypted on read (queryEngine / findWithDecryption), so without this stage
 *      their plaintext would leak into the context. Removed unconditionally.
 *   2. `pii` — fields whose name matches a conservative PII pattern (email, phone,
 *      ssn, tax id, dob, address, …). Least-privilege: a capability's declared
 *      `fields` allowlist is the first gate; this is the second, name-based gate
 *      for PII that slips through a permissive projection.
 *
 * The withheld field name + rule is recorded in `redactionApplied` so the trace
 * inspector and compliance lineage can audit exactly what the agent did NOT see.
 * Redaction REMOVES the field from the record (it is never blanked-but-present),
 * so a downstream serializer cannot accidentally echo a stale plaintext value.
 *
 * The encrypted-field source is pluggable: the resolver passes a resolver that
 * consults `TenantDataEncryptionService.getEncryptedFieldNames` per tenant, with
 * the module's static `defaultEncryptionMaps` as the always-on floor (so redaction
 * still happens when encryption-at-rest is disabled in a given environment).
 */

export const REDACTION_RULE_FIELD_ENCRYPTION = 'field_encryption'
export const REDACTION_RULE_PII = 'pii'

/**
 * Conservative PII field-name patterns. Matched case-insensitively against the
 * snake_case and camelCase forms of a record key. Intentionally narrow — broad
 * enough to catch the obvious direct-identifier columns, never so broad it eats a
 * benign field like `title`/`status` (those are the mandatory-floor fields).
 */
const PII_FIELD_PATTERNS: RegExp[] = [
  /(^|_)email($|_)/i,
  /(^|_)phone($|_)/i,
  /(^|_)mobile($|_)/i,
  /(^|_)ssn($|_)/i,
  /social_security/i,
  /(^|_)tax_id($|_)/i,
  /(^|_)passport($|_)/i,
  /(^|_)national_id($|_)/i,
  /(^|_)date_of_birth($|_)/i,
  /(^|_)dob($|_)/i,
  /(^|_)address($|_)/i,
  /(^|_)postal_code($|_)/i,
  /(^|_)iban($|_)/i,
  /(^|_)credit_card($|_)/i,
  /(^|_)card_number($|_)/i,
]

const toSnakeCase = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/__/g, '_').toLowerCase()

function isPiiFieldName(field: string): boolean {
  const snake = toSnakeCase(field)
  return PII_FIELD_PATTERNS.some((pattern) => pattern.test(field) || pattern.test(snake))
}

/**
 * Build the set of encrypted field names for an entity from the module's static
 * encryption maps. The `entityId` is matched case-insensitively. This is the
 * always-on floor; the per-tenant `TenantDataEncryptionService` map is layered on
 * top by the resolver (it can mark additional fields encrypted per tenant).
 */
export function staticEncryptedFieldNames(
  entityId: string,
  maps: ModuleEncryptionMap[],
): string[] {
  const target = entityId.toLowerCase()
  const fields: string[] = []
  for (const map of maps) {
    if (map.entityId.toLowerCase() !== target) continue
    for (const rule of map.fields) {
      if (typeof rule.field === 'string' && rule.field.trim()) fields.push(rule.field)
    }
  }
  return fields
}

/** A normalized key set for matching record keys regardless of casing. */
function keyVariants(field: string): string[] {
  const snake = toSnakeCase(field)
  const camel = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  return [...new Set([field, snake, camel])]
}

export type RedactionResult = {
  /** The record with encrypted/PII fields removed (agent-visible). */
  record: Record<string, unknown>
  /** What was withheld, for the bundle audit. */
  redactions: ContextRedactionApplied[]
}

/**
 * Redact a single record. Removes any key that the encryption map marks as
 * encrypted (`field_encryption`) or whose name matches a PII pattern (`pii`),
 * recording each removal. A key only present once is recorded once; the
 * encryption rule takes precedence over PII when a field matches both.
 */
export function redactRecord(
  record: Record<string, unknown>,
  encryptedFields: string[],
): RedactionResult {
  const redacted: Record<string, unknown> = { ...record }
  const redactions: ContextRedactionApplied[] = []
  const seen = new Set<string>()

  const removeKey = (field: string, rule: string): void => {
    for (const variant of keyVariants(field)) {
      if (!Object.prototype.hasOwnProperty.call(redacted, variant)) continue
      if (redacted[variant] === undefined || redacted[variant] === null) {
        delete redacted[variant]
        continue
      }
      delete redacted[variant]
      if (!seen.has(variant)) {
        seen.add(variant)
        redactions.push({ field: variant, rule })
      }
    }
  }

  for (const field of encryptedFields) removeKey(field, REDACTION_RULE_FIELD_ENCRYPTION)

  for (const key of Object.keys(redacted)) {
    if (seen.has(key)) continue
    if (isPiiFieldName(key)) removeKey(key, REDACTION_RULE_PII)
  }

  return { record: redacted, redactions }
}
