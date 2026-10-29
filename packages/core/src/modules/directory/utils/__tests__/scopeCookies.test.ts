/**
 * Backward-compatibility pin for the scope-cookie constants and parsers.
 *
 * Their implementation moved to `@open-mercato/shared/lib/scope/cookies` so that
 * `shared` — which must not depend on `core` — stops inlining private copies of the
 * cookie names, the all-organizations sentinel and the parsing. All three `core`
 * import paths below are public contract surfaces (BACKWARD_COMPATIBILITY.md §4), so
 * this suite asserts that the move is invisible from outside: same names, same values,
 * same parser behaviour, from the same paths.
 */
import {
  ALL_ORGANIZATIONS_COOKIE_VALUE,
  SELECTED_ORGANIZATION_COOKIE,
  SELECTED_TENANT_COOKIE,
  isAllOrganizationsSelection,
} from '@open-mercato/core/modules/directory/constants'
import {
  parseSelectedOrganizationCookie,
  parseSelectedTenantCookie,
} from '@open-mercato/core/modules/directory/utils/scopeCookies'
import * as sharedScopeCookies from '@open-mercato/shared/lib/scope/cookies'
import * as organizationScope from '@open-mercato/core/modules/directory/utils/organizationScope'

describe('modules/directory/constants re-export bridge', () => {
  it('still exports the sentinel and its predicate with unchanged values', () => {
    expect(ALL_ORGANIZATIONS_COOKIE_VALUE).toBe('__all__')
    expect(isAllOrganizationsSelection(ALL_ORGANIZATIONS_COOKIE_VALUE)).toBe(true)
    expect(isAllOrganizationsSelection('org-1')).toBe(false)
    expect(isAllOrganizationsSelection(null)).toBe(false)
  })

  it('is the same binding as the shared module, not a second copy', () => {
    expect(ALL_ORGANIZATIONS_COOKIE_VALUE).toBe(sharedScopeCookies.ALL_ORGANIZATIONS_COOKIE_VALUE)
    expect(isAllOrganizationsSelection).toBe(sharedScopeCookies.isAllOrganizationsSelection)
  })

  it('additionally exposes the two cookie names that had no canonical home before', () => {
    expect(SELECTED_ORGANIZATION_COOKIE).toBe('om_selected_org')
    expect(SELECTED_TENANT_COOKIE).toBe('om_selected_tenant')
  })
})

describe('modules/directory/utils/scopeCookies re-export bridge', () => {
  it('is the same binding as the shared module', () => {
    expect(parseSelectedOrganizationCookie).toBe(sharedScopeCookies.parseSelectedOrganizationCookie)
    expect(parseSelectedTenantCookie).toBe(sharedScopeCookies.parseSelectedTenantCookie)
  })

  it('keeps being re-exported from ./organizationScope', () => {
    expect(organizationScope.parseSelectedOrganizationCookie).toBe(parseSelectedOrganizationCookie)
    expect(organizationScope.parseSelectedTenantCookie).toBe(parseSelectedTenantCookie)
  })

  // The behaviour these two had before the move, restated here so the bridge is
  // pinned from the consumer's side and not only inside `shared`.
  it.each([
    ['a plain id', 'om_selected_org=org-1', 'org-1'],
    ['a percent-encoded value, untrimmed', 'om_selected_org=%20org-1%20', ' org-1 '],
    ['a malformed value, falling back to raw', 'om_selected_org=%E0%A4%A', '%E0%A4%A'],
    ['the all-organizations sentinel, verbatim', 'om_selected_org=__all__', '__all__'],
    ['a value among other cookies', 'auth_token=jwt; om_selected_org=org-1', 'org-1'],
    ['a blank value, as no selection', 'om_selected_org=', null],
    ['an absent cookie', 'auth_token=jwt', null],
    ['no header', '', null],
  ])('parseSelectedOrganizationCookie reads %s', (_label, header, expected) => {
    expect(parseSelectedOrganizationCookie(header)).toBe(expected)
  })

  it.each([
    ['a plain id', 'om_selected_tenant=tenant-1', 'tenant-1'],
    ['a blank value, as no selection', 'om_selected_tenant=', null],
    ['an absent cookie', 'auth_token=jwt', null],
  ])('parseSelectedTenantCookie reads %s', (_label, header, expected) => {
    expect(parseSelectedTenantCookie(header)).toBe(expected)
  })

  it('accepts null and undefined headers, as it always did', () => {
    expect(parseSelectedOrganizationCookie(null)).toBeNull()
    expect(parseSelectedOrganizationCookie(undefined)).toBeNull()
    expect(parseSelectedTenantCookie(null)).toBeNull()
    expect(parseSelectedTenantCookie(undefined)).toBeNull()
  })
})
