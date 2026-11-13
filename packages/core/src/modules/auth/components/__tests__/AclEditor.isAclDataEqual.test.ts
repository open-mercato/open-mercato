import { isAclDataEqual, type AclData } from '../AclEditor'

/**
 * TC-AUTH-8714 [regression]: unchanged-ACL detection (#8714)
 *
 * `page.tsx`'s onSubmit skips resubmitting the ACL mutation when the current
 * form state matches the loaded baseline, so an org-scoped editor resubmitting
 * a target's unrestricted/inherited ACL unchanged does not risk a scoped-grant
 * refusal after the primary user write already persisted. This isolates the
 * comparison helper that decision is built on.
 */
describe('isAclDataEqual', () => {
  const base: AclData = { isSuperAdmin: false, features: [], organizations: null }

  it('treats identical snapshots as equal', () => {
    expect(isAclDataEqual(base, { ...base })).toBe(true)
  })

  it('is order-insensitive for features and organizations', () => {
    const a: AclData = { isSuperAdmin: false, features: ['b', 'a'], organizations: ['org-2', 'org-1'] }
    const b: AclData = { isSuperAdmin: false, features: ['a', 'b'], organizations: ['org-1', 'org-2'] }
    expect(isAclDataEqual(a, b)).toBe(true)
  })

  it('distinguishes unrestricted (null) organizations from an empty deny-all list', () => {
    const unrestricted: AclData = { ...base, organizations: null }
    const denyAll: AclData = { ...base, organizations: [] }
    expect(isAclDataEqual(unrestricted, denyAll)).toBe(false)
  })

  it('detects a changed super admin flag', () => {
    expect(isAclDataEqual(base, { ...base, isSuperAdmin: true })).toBe(false)
  })

  it('detects a changed feature set', () => {
    expect(isAclDataEqual(base, { ...base, features: ['auth.acl.manage'] })).toBe(false)
  })

  it('detects a changed organization scope', () => {
    const current: AclData = { ...base, organizations: ['org-1'] }
    expect(isAclDataEqual(base, current)).toBe(false)
  })
})
