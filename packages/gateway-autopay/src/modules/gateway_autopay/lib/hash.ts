import { createHash } from 'node:crypto'

export type AutopayHashAlgorithm = 'sha256' | 'sha512'

/**
 * Autopay signs every message (session initiation, return redirect, ITN,
 * status query, cancel, refund) with a plain concatenated hash, never HMAC:
 *   Hash = algorithm(field1 + "|" + field2 + ... + "|" + sharedKey)
 * Fields are joined in ascending "kolejność Hash" order. A missing/empty
 * optional field is dropped entirely — never represented by an empty
 * placeholder between two "|" separators. Confirmed verbatim against the
 * official docs' own worked examples (see __tests__/hash.test.ts).
 */
export function computeAutopayHash(
  fields: Array<string | number | null | undefined>,
  sharedKey: string,
  algorithm: AutopayHashAlgorithm = 'sha256',
): string {
  const parts = fields
    .filter((value) => value !== null && value !== undefined && String(value) !== '')
    .map((value) => String(value))
  parts.push(sharedKey)
  return createHash(algorithm).update(parts.join('|'), 'utf8').digest('hex')
}
