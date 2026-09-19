import { extractPhoneDigits } from '../phone'
import { withProfile, type DisplayProfile } from './profile'

const PLACEHOLDER = '#'

/**
 * Render an E.164 number in the market's national pattern.
 *
 * Storage never changes (spec invariant 2): this is display only, and a number that does not belong
 * to the market's dial code is returned as stored, because `(214) 555-0100` applied to a Polish
 * number would be a lie about which country it reaches.
 */
export function formatPhone(value: string | null | undefined, profile?: DisplayProfile | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const resolved = withProfile(profile)
  const pattern = resolved.phoneNationalPattern
  const dialCode = resolved.phoneDefaultDialCode
  if (!pattern || !dialCode) return trimmed

  const dialDigits = extractPhoneDigits(dialCode)
  const digits = extractPhoneDigits(trimmed)
  if (!dialDigits || !digits.startsWith(dialDigits)) return trimmed

  const national = digits.slice(dialDigits.length)
  const slots = (pattern.match(/#/g) ?? []).length
  if (national.length !== slots) return trimmed

  let index = 0
  let rendered = ''
  for (const character of pattern) {
    if (character === PLACEHOLDER) {
      rendered += national[index] ?? ''
      index += 1
    } else {
      rendered += character
    }
  }
  return rendered
}

/**
 * Turn what a user typed into the E.164 the validator and the database expect.
 *
 * `214-555-0100` is how a US merchant writes their own number, and today's validator rejects
 * anything without a leading `+`. Prepending the market's dial code is what makes the national form
 * acceptable without weakening the stored contract. A value that already carries `+` is left alone.
 */
export function normalizePhoneInput(value: string | null | undefined, profile?: DisplayProfile | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) return trimmed

  const dialCode = withProfile(profile).phoneDefaultDialCode
  if (!dialCode) return trimmed

  const digits = extractPhoneDigits(trimmed)
  if (!digits) return trimmed

  const dialDigits = extractPhoneDigits(dialCode)
  // A user who typed the country code without the plus should not get it twice.
  const national = dialDigits && digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits
  if (!national) return trimmed
  return `+${dialDigits}${national}`
}
