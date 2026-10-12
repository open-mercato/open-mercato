/**
 * PL account-numbering rules (PR #5663 review, rules 3 and 4).
 *
 * Applied in the commands, not only in the forms, so the backend rejects a
 * mismatch whatever the UI sends. They bind only types whose group belongs
 * to the Polish chart (`jurisdiction: 'PL'`): in the zakładowy plan kont the
 * first digit of a synthetic number is the zespół, and an analytic account
 * extends its synthetic number.
 */

export const PL_JURISDICTION = 'PL'

/** Longest business key accepted for a type or account number. */
export const ACCOUNT_NUMBER_MAX_LENGTH = 50

export type NumberingGroup = { jurisdiction: string; code: string } | null | undefined

export type TypeNumberViolation = 'format' | 'groupDigit'

/** Whether the PL numbering rules apply to a type in this group. */
export function isPolishGroup(group: NumberingGroup): group is { jurisdiction: string; code: string } {
  return !!group && group.jurisdiction === PL_JURISDICTION
}

/**
 * A PL type number is exactly three digits and its first digit is the
 * group's `code`. Returns `null` when the number is acceptable or the rule
 * does not apply (no group, or a non-PL group).
 */
export function checkTypeNumber(number: string, group: NumberingGroup): TypeNumberViolation | null {
  if (!isPolishGroup(group)) return null
  if (!/^\d{3}$/.test(number)) return 'format'
  if (number.charAt(0) !== group.code) return 'groupDigit'
  return null
}

/**
 * A PL account number extends its type's number (type `130`, account
 * `130-1`; the bare type number is allowed too). Returns `true` when the
 * number is acceptable or the rule does not apply.
 */
export function accountNumberFitsType(accountNumber: string, typeNumber: string, group: NumberingGroup): boolean {
  if (!isPolishGroup(group)) return true
  return accountNumber.startsWith(typeNumber)
}

/**
 * What a number input should hold after its fixed prefix changes from
 * `previous` to `next` (the group's code or the type's number, `null` while
 * it is still loading or when there is none).
 *
 * Keeps the ending the user typed and swaps the prefix. When the prefix only
 * just became known (`previous` is `null`) and the value already starts with
 * it — an edit form that loaded `406` before the group code `4` arrived —
 * the value is left alone; prefixing it again would turn `406` into `4406`.
 */
export function reprefixNumber(current: string, previous: string | null, next: string | null): string {
  if (previous === next) return current
  const carriesPrevious = !!previous && current.startsWith(previous)
  if (!previous && next && current.startsWith(next)) return current
  const ending = carriesPrevious ? current.slice((previous as string).length) : current
  if (next) return `${next}${ending}`
  return carriesPrevious ? ending : current
}
