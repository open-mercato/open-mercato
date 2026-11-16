/**
 * Polish NIP (tax identification number) helpers.
 *
 * Client-safe: no server-only imports, so the lookup widget can validate
 * the NIP before it calls the API.
 */

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const

/** Strips spaces, dashes and an optional `PL` prefix. Returns digits only. */
export function normalizeNip(raw: string): string {
  return raw.replace(/^\s*PL/i, '').replace(/[^0-9]/g, '')
}

/**
 * Validates a 10-digit NIP with the official mod-11 checksum. The structure
 * follows the MF XSD type `TNrNIP`: the 3-digit tax office prefix never starts
 * with 0 and never ends in "00" (rejects e.g. 0000000000).
 */
export function isValidNip(raw: string): boolean {
  const nip = normalizeNip(raw)
  if (!/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(nip)) return false
  const digits = nip.split('').map(Number)
  const sum = NIP_WEIGHTS.reduce((acc, weight, index) => acc + weight * digits[index], 0)
  const control = sum % 11
  if (control === 10) return false
  return control === digits[9]
}
