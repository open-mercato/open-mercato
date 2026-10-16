/**
 * The organization-selection cookies written by the top-bar `OrganizationSwitcher`,
 * and the single implementation that reads them.
 *
 * These values used to be inlined wherever they were needed, because
 * `@open-mercato/shared` must not depend on `@open-mercato/core`, where
 * `modules/directory/constants` declared them. That produced independent copies of
 * both the names and the parsing, in `lib/auth/server.ts`, `lib/crud/factory.ts` and
 * `modules/directory/utils/scopeCookies.ts`. They are hoisted here — the leaf of the
 * dependency graph, which every package may import — and `core`'s
 * `modules/directory/constants` and `modules/directory/utils/scopeCookies` now
 * re-export from this module, so no existing import path changes.
 *
 * ## Blank-value semantic
 *
 * A selection cookie that is present but blank (`om_selected_org=`) means **no
 * selection**, exactly as if the cookie were absent. `parseScopeSelectionCookie` and
 * its two named wrappers collapse both to `null`, and that is the semantic every
 * *selection* reader gets.
 *
 * The reasoning: the all-organizations choice has its own sentinel — nothing writes a
 * blank value to express it — so a blank cookie carries no selection, only the residue
 * of one being cleared. Reading it as "all organizations" would let a cleared cookie
 * silently widen scope; reading it as "no selection" falls back to the caller's own
 * organization, which is the conservative direction and what the server-side resolver
 * has always done.
 *
 * One caller legitimately needs to tell blank from absent: the super-admin cookie
 * override in `lib/auth/server.ts` reports "the browser asked for all organizations"
 * for a blank organization cookie but "no override at all" when the cookie is missing,
 * and those two produce different auth contexts. So the distinction is not hidden — it
 * is available through `readScopeCookieRaw`, which returns `undefined` only for an
 * absent cookie and `''` for a present blank one. Selection readers should prefer the
 * parsers; reach for the raw pair only when absent and blank must genuinely differ, and
 * say why at the call site.
 */

export const SELECTED_ORGANIZATION_COOKIE = 'om_selected_org'
export const SELECTED_TENANT_COOKIE = 'om_selected_tenant'

/**
 * Value of `SELECTED_ORGANIZATION_COOKIE` meaning "every organization the caller may
 * see", as opposed to one particular organization. There is no all-tenants equivalent.
 */
export const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'

export type ScopeCookieName = typeof SELECTED_ORGANIZATION_COOKIE | typeof SELECTED_TENANT_COOKIE

export function isAllOrganizationsSelection(value: string | null | undefined): boolean {
  return value === ALL_ORGANIZATIONS_COOKIE_VALUE
}

/**
 * Find `name` in a `Cookie:` header (or in `document.cookie`, which has the same
 * shape) and return its value still percent-encoded.
 *
 * Lossless on purpose: `undefined` means the cookie is absent, `''` means it is
 * present and blank. See the blank-value note above for who needs that difference.
 */
export function readScopeCookieRaw(
  header: string | null | undefined,
  name: ScopeCookieName,
): string | undefined {
  if (!header) return undefined
  const prefix = `${name}=`
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return undefined
}

/**
 * Percent-decode a raw cookie value, falling back to the raw text when the browser (or
 * anything else) left it malformed. `undefined` in — meaning an absent cookie — gives
 * `null` out.
 *
 * Deliberately does not trim: `%20org-1%20` decodes to `' org-1 '`, and normalising
 * that is the scope resolver's job, not the parser's.
 */
export function decodeScopeCookieValue(raw: string | undefined): string | null {
  if (raw === undefined) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Read a selection cookie under the documented blank-value semantic: `null` for an
 * absent cookie, a blank one, and a missing header alike.
 */
export function parseScopeSelectionCookie(
  header: string | null | undefined,
  name: ScopeCookieName,
): string | null {
  return decodeScopeCookieValue(readScopeCookieRaw(header, name)) || null
}

export function parseSelectedOrganizationCookie(header: string | null | undefined): string | null {
  return parseScopeSelectionCookie(header, SELECTED_ORGANIZATION_COOKIE)
}

export function parseSelectedTenantCookie(header: string | null | undefined): string | null {
  return parseScopeSelectionCookie(header, SELECTED_TENANT_COOKIE)
}
