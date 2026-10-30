/**
 * `signature` field type — W2 (CN-1, FD-4; partial CN-2 / CN-3).
 *
 * Captures a patient / signer e-signature with tamper-evident audit data. This
 * is the defining capability for the consent / legal form category.
 *
 * Value shape (stored in the encrypted revision answers — never a side path):
 *   {
 *     mode: 'drawn' | 'typed',
 *     image?: string,        // data URL (PNG) for drawn mode
 *     typedName?: string,    // for typed mode
 *     affirmed: true,        // explicit affirmation checkbox must be true
 *     signedAt: string,      // ISO UTC timestamp (client-captured)
 *     clauseSha256: string,  // SHA-256 of the exact consent clause text shown
 *   }
 *
 * The signed record = version-pinned schema (`form_version`, immutable once
 * published) + encrypted answers (incl. this signature payload — append-only,
 * per-tenant envelope encryption) + submit metadata (IP / UA / UTC ts captured
 * server-side at submit). Together these form the tamper-evident bundle. Full
 * PDF reproduction of the signed record is W3.
 *
 * The `signature` type is ADDITIVE — registered through the standard
 * `FieldTypeRegistry.register(...)` API; it does NOT appear in the FROZEN v1
 * core list (`packages/forms/AGENTS.md § v1 Field Types`).
 *
 * New `x-om-*` keywords (all additive, registered in `jsonschema-extensions.ts`):
 *   - `x-om-consent-clause` — `{ [locale]: string }` legal statement shown above
 *     the signature area (the text whose SHA-256 the signer affirms).
 *   - `x-om-signature-modes` — `('drawn'|'typed')[]` allowed capture modes
 *     (default both).
 */

import type { FieldNode, FieldTypeSpec } from './field-type-registry'

export const SIGNATURE_TYPE_KEY = 'signature' as const

export const SIGNATURE_MODES = ['drawn', 'typed'] as const
export type SignatureMode = (typeof SIGNATURE_MODES)[number]

/** Value persisted in a `signature`-field answer. */
export type SignatureValue = {
  mode: SignatureMode
  image?: string
  typedName?: string
  affirmed: true
  signedAt: string
  clauseSha256: string
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

function isSignatureMode(value: unknown): value is SignatureMode {
  return value === 'drawn' || value === 'typed'
}

/**
 * Reads the allowed capture modes for a signature field. Absent / malformed
 * `x-om-signature-modes` defaults to both modes. Unknown entries are dropped;
 * an empty result also falls back to both modes (R: never lock a signer out of
 * every mode through a bad config).
 */
export function readSignatureModes(fieldNode: FieldNode): SignatureMode[] {
  const raw = (fieldNode as Record<string, unknown>)['x-om-signature-modes']
  if (!Array.isArray(raw)) return [...SIGNATURE_MODES]
  const modes = raw.filter(isSignatureMode)
  return modes.length > 0 ? Array.from(new Set(modes)) : [...SIGNATURE_MODES]
}

export const SIGNATURE_TYPE: FieldTypeSpec = {
  validator: (value, fieldNode) => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'object' || Array.isArray(value)) {
      return 'Signature must be an object.'
    }
    const candidate = value as Record<string, unknown>
    if (!isSignatureMode(candidate.mode)) {
      return 'Signature mode must be "drawn" or "typed".'
    }
    const allowedModes = readSignatureModes(fieldNode)
    if (!allowedModes.includes(candidate.mode)) {
      return `Signature mode "${candidate.mode}" is not allowed for this field.`
    }
    if (candidate.affirmed !== true) {
      return 'You must affirm the consent statement before signing.'
    }
    if (typeof candidate.clauseSha256 !== 'string' || !SHA256_HEX_PATTERN.test(candidate.clauseSha256)) {
      return 'Signature is missing the consent clause fingerprint.'
    }
    if (typeof candidate.signedAt !== 'string' || Number.isNaN(Date.parse(candidate.signedAt))) {
      return 'Signature is missing a valid signed-at timestamp.'
    }
    if (candidate.mode === 'drawn') {
      if (typeof candidate.image !== 'string' || candidate.image.length === 0) {
        return 'A drawn signature requires a captured image.'
      }
    } else {
      if (typeof candidate.typedName !== 'string' || candidate.typedName.trim().length === 0) {
        return 'A typed signature requires a name.'
      }
    }
    return true
  },
  renderer: null,
  defaultUiSchema: { widget: 'signature' },
  exportAdapter: (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    const candidate = value as Record<string, unknown>
    if (!isSignatureMode(candidate.mode)) return ''
    const signedAt = typeof candidate.signedAt === 'string' ? candidate.signedAt : ''
    const who =
      candidate.mode === 'typed' && typeof candidate.typedName === 'string' && candidate.typedName.trim().length > 0
        ? candidate.typedName.trim()
        : 'drawn'
    return signedAt.length > 0 ? `Signed by ${who} on ${signedAt}` : `Signed by ${who}`
  },
  category: 'input',
  icon: 'pen-tool',
  displayNameKey: 'forms.studio.palette.input.signature',
}
