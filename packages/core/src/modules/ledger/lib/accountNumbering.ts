/**
 * PL account-numbering rules.
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
 * just became known (`previous` is `null`) a non-empty value is left alone:
 * an edit form that loaded `406` or `999` before the group code arrived must
 * not have its stored number rewritten (`406` → `4406`, `999` → `4999`).
 * Only an empty field takes the new prefix.
 */
export function reprefixNumber(current: string, previous: string | null, next: string | null): string {
  if (previous === next) return current
  // The prefix only just became known: this is the form finishing its load
  // (or the first group/type pick on a new form), not a change the user made.
  // A stored value is never rewritten — only an empty field takes the prefix.
  if (!previous) return current === '' && next ? next : current
  const carriesPrevious = current.startsWith(previous)
  const ending = carriesPrevious ? current.slice(previous.length) : current
  if (next) return `${next}${ending}`
  return carriesPrevious ? ending : current
}

export type AccountRenumberPlan = {
  renames: Array<{ id: string; from: string; to: string }>
  /** Accounts that start with neither the old nor the new type number. */
  unfixable: string[]
}

/**
 * What happens to a type's accounts when the type number changes from
 * `previous` to `next`: an account that starts with `previous` swaps that
 * prefix for `next` (`402-01` → `412-01`), one that already starts with `next`
 * stays, and one that starts with neither cannot be brought under the rule
 * automatically.
 */
export function planAccountRenumber(
  accounts: Array<{ id: string; number: string }>,
  previous: string,
  next: string,
): AccountRenumberPlan {
  const renames: AccountRenumberPlan['renames'] = []
  const unfixable: string[] = []
  for (const account of accounts) {
    if (account.number.startsWith(previous)) {
      renames.push({ id: account.id, from: account.number, to: `${next}${account.number.slice(previous.length)}` })
    } else if (!account.number.startsWith(next)) {
      unfixable.push(account.id)
    }
  }
  return { renames, unfixable }
}
