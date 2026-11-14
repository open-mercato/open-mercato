import {
  ALL_ORGANIZATIONS_COOKIE_VALUE,
  SELECTED_ORGANIZATION_COOKIE,
  SELECTED_TENANT_COOKIE,
  decodeScopeCookieValue,
  isAllOrganizationsSelection,
  parseScopeSelectionCookie,
  parseSelectedOrganizationCookie,
  parseSelectedTenantCookie,
  readScopeCookieRaw,
} from '../cookies'

describe('scope cookie constants', () => {
  // These three strings are the wire format. They are written by the browser-side
  // OrganizationSwitcher and read by the server, so they cannot change without a
  // coordinated release — pin the literals, not just the symbols.
  it('carries the wire values every package used to inline', () => {
    expect(SELECTED_ORGANIZATION_COOKIE).toBe('om_selected_org')
    expect(SELECTED_TENANT_COOKIE).toBe('om_selected_tenant')
    expect(ALL_ORGANIZATIONS_COOKIE_VALUE).toBe('__all__')
  })

  it('recognises the all-organizations sentinel and nothing else', () => {
    expect(isAllOrganizationsSelection('__all__')).toBe(true)
    expect(isAllOrganizationsSelection('org-1')).toBe(false)
    // A blank value is NOT the sentinel — see the blank-value note in the module.
    expect(isAllOrganizationsSelection('')).toBe(false)
    expect(isAllOrganizationsSelection(null)).toBe(false)
    expect(isAllOrganizationsSelection(undefined)).toBe(false)
  })
})

describe('readScopeCookieRaw', () => {
  it('finds the cookie regardless of position or surrounding whitespace', () => {
    const header = `auth_token=jwt; ${SELECTED_ORGANIZATION_COOKIE}=org-1;${SELECTED_TENANT_COOKIE}=tenant-1`
    expect(readScopeCookieRaw(header, SELECTED_ORGANIZATION_COOKIE)).toBe('org-1')
    expect(readScopeCookieRaw(header, SELECTED_TENANT_COOKIE)).toBe('tenant-1')
  })

  it('does not decode', () => {
    expect(readScopeCookieRaw(`${SELECTED_ORGANIZATION_COOKIE}=%20org-1%20`, SELECTED_ORGANIZATION_COOKIE))
      .toBe('%20org-1%20')
  })

  it('reports an absent cookie as undefined and a blank one as an empty string', () => {
    // This is the distinction `applySuperAdminScope` is built on: a blank
    // organization cookie is an applied override ("all organizations") while a
    // missing one is no override at all. Collapsing the two here would change auth.
    expect(readScopeCookieRaw('auth_token=jwt', SELECTED_ORGANIZATION_COOKIE)).toBeUndefined()
    expect(readScopeCookieRaw(`${SELECTED_ORGANIZATION_COOKIE}=`, SELECTED_ORGANIZATION_COOKIE)).toBe('')
    expect(readScopeCookieRaw(null, SELECTED_ORGANIZATION_COOKIE)).toBeUndefined()
    expect(readScopeCookieRaw(undefined, SELECTED_ORGANIZATION_COOKIE)).toBeUndefined()
    expect(readScopeCookieRaw('', SELECTED_ORGANIZATION_COOKIE)).toBeUndefined()
  })

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    expect(readScopeCookieRaw(`x_${SELECTED_ORGANIZATION_COOKIE}=org-1`, SELECTED_ORGANIZATION_COOKIE))
      .toBeUndefined()
  })
})

describe('decodeScopeCookieValue', () => {
  it('percent-decodes, and keeps whitespace for the resolver to normalise', () => {
    expect(decodeScopeCookieValue('%20org-1%20')).toBe(' org-1 ')
  })

  it('falls back to the raw text when the value is malformed', () => {
    expect(decodeScopeCookieValue('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('maps an absent cookie to null and keeps a blank one blank', () => {
    expect(decodeScopeCookieValue(undefined)).toBeNull()
    expect(decodeScopeCookieValue('')).toBe('')
  })
})

describe('parseScopeSelectionCookie — the documented blank-value semantic', () => {
  // THE decision this module records: for a *selection*, blank reads exactly like
  // absent. Neither means "all organizations"; that choice has its own sentinel and
  // nothing writes a blank value to express it. A blank cookie is the residue of a
  // cleared selection, so falling back to the caller's own organization is the
  // conservative reading and the one the server-side resolver has always used.
  it.each([
    ['absent', 'auth_token=jwt'],
    ['blank', `${SELECTED_ORGANIZATION_COOKIE}=`],
    ['no header at all', ''],
  ])('reads a %s organization cookie as no selection', (_label, header) => {
    expect(parseSelectedOrganizationCookie(header)).toBeNull()
  })

  it('applies the same semantic to the tenant cookie', () => {
    expect(parseSelectedTenantCookie('auth_token=jwt')).toBeNull()
    expect(parseSelectedTenantCookie(`${SELECTED_TENANT_COOKIE}=`)).toBeNull()
    expect(parseSelectedTenantCookie(`${SELECTED_TENANT_COOKIE}=tenant-1`)).toBe('tenant-1')
  })

  it('returns the all-organizations sentinel verbatim rather than nulling it', () => {
    // The sentinel is a selection, so the parser must hand it on for
    // `isAllOrganizationsSelection` to act on; only a blank value is "no selection".
    expect(parseSelectedOrganizationCookie(`${SELECTED_ORGANIZATION_COOKIE}=${ALL_ORGANIZATIONS_COOKIE_VALUE}`))
      .toBe(ALL_ORGANIZATIONS_COOKIE_VALUE)
  })

  it('preserves the historical decoding behaviour, including no trimming', () => {
    expect(parseSelectedOrganizationCookie(`${SELECTED_ORGANIZATION_COOKIE}=%20org-1%20`)).toBe(' org-1 ')
    expect(parseSelectedOrganizationCookie(`${SELECTED_ORGANIZATION_COOKIE}=%E0%A4%A`)).toBe('%E0%A4%A')
  })

  it('is the shared body behind both named parsers', () => {
    const header = `${SELECTED_ORGANIZATION_COOKIE}=org-1; ${SELECTED_TENANT_COOKIE}=tenant-1`
    expect(parseScopeSelectionCookie(header, SELECTED_ORGANIZATION_COOKIE))
      .toBe(parseSelectedOrganizationCookie(header))
    expect(parseScopeSelectionCookie(header, SELECTED_TENANT_COOKIE))
      .toBe(parseSelectedTenantCookie(header))
  })
})

describe('the two readings are related, not interchangeable', () => {
  // Guard against a future "tidy-up" collapsing the raw reader into the parser: the
  // parser deliberately loses the absent/blank difference, and one caller needs it.
  it('agrees on a real value and diverges only on a blank cookie', () => {
    const withValue = `${SELECTED_ORGANIZATION_COOKIE}=org-1`
    expect(readScopeCookieRaw(withValue, SELECTED_ORGANIZATION_COOKIE)).toBe('org-1')
    expect(parseSelectedOrganizationCookie(withValue)).toBe('org-1')

    const blank = `${SELECTED_ORGANIZATION_COOKIE}=`
    expect(readScopeCookieRaw(blank, SELECTED_ORGANIZATION_COOKIE)).toBe('')
    expect(parseSelectedOrganizationCookie(blank)).toBeNull()
  })
})
