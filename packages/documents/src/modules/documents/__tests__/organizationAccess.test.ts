import { hasResolvedDocumentsOrganizationAccess } from '../lib/organizationAccess'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'

describe('Documents organization authorization boundary', () => {
  it.each([
    [{ isSuperAdmin: true, organizations: [] }, null],
    [{ isSuperAdmin: false, organizations: null }, null],
    [{ isSuperAdmin: false, organizations: ['__all__'] }, null],
    [{ isSuperAdmin: false, organizations: [ORGANIZATION_ID] }, null],
  ])('accepts an unrestricted or exact current grant', (acl, scope) => {
    expect(hasResolvedDocumentsOrganizationAccess(acl, ORGANIZATION_ID, scope)).toBe(true)
  })

  it('accepts a selected child only when the expansion retains its parent grant', () => {
    expect(hasResolvedDocumentsOrganizationAccess(
      { isSuperAdmin: false, organizations: [PARENT_ORGANIZATION_ID] },
      ORGANIZATION_ID,
      { selectedId: ORGANIZATION_ID, allowedIds: [PARENT_ORGANIZATION_ID, ORGANIZATION_ID] },
    )).toBe(true)
  })

  it.each([
    ['empty allowlist fallback', [], [ORGANIZATION_ID]],
    ['unresolved grant fallback', [OTHER_ORGANIZATION_ID], [ORGANIZATION_ID]],
    ['different expanded grant', [OTHER_ORGANIZATION_ID], [OTHER_ORGANIZATION_ID]],
  ])('rejects %s', (_label, organizations, allowedIds) => {
    expect(hasResolvedDocumentsOrganizationAccess(
      { isSuperAdmin: false, organizations },
      ORGANIZATION_ID,
      { selectedId: ORGANIZATION_ID, allowedIds },
    )).toBe(false)
  })
})
