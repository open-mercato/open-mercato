/**
 * Referral codes: generating them and reading back what somebody typed.
 *
 * Pure, and the alphabet is the decision worth explaining. A referral code is read aloud, typed from a
 * screenshot and written on paper, so this uses **Crockford base32** — the digits and letters with `I`, `L`,
 * `O` and `U` removed, and a documented rule for folding the characters people substitute for them. Inventing
 * an alphabet here was the first attempt and it went wrong immediately: the fold mapped `L` onto another
 * letter that was itself in the alphabet, so a legitimate code containing it stopped resolving.
 */

/** Crockford base32, in order. `U` is excluded as well as `I`, `L` and `O`. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Eight characters is forty bits — far beyond guessing in the number of attempts a redemption endpoint will
 * ever serve, and still short enough to say over a phone.
 */
export const REFERRAL_CODE_LENGTH = 8

export function generateReferralCode(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH)
  let code = ''
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    // A byte over a 32-symbol alphabet divides exactly, so there is no modulo bias to reason about.
    code += ALPHABET[bytes[index] % ALPHABET.length]
  }
  return code
}

/**
 * Normalises what somebody typed, by Crockford's own rules.
 *
 * Upper-cases, drops the separators people add for readability, and folds each excluded character onto the
 * one it was misread FROM: `O` onto zero, `I` and `L` onto one. `U` folds onto `V`, which Crockford leaves
 * open and which is the substitution people actually make when reading handwriting.
 */
export function normalizeReferralCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V')
}

/**
 * Whether a normalised code could have come from the generator.
 *
 * Checked before any lookup, so a malformed code is refused by shape rather than by a database miss — one
 * less way to use the endpoint as a probe, and one less query per attempt.
 */
export function isValidReferralCode(code: string): boolean {
  if (code.length !== REFERRAL_CODE_LENGTH) return false
  for (const char of code) {
    if (!ALPHABET.includes(char)) return false
  }
  return true
}

/** The shareable link for a code, when the tenant configured somewhere to send people. */
export function referralUrlFor(template: string | null, code: string): string | null {
  if (!template || !template.includes('{code}')) return null
  return template.replace('{code}', encodeURIComponent(code))
}
