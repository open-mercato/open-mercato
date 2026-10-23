import { bindProjectAccessScope, type ProjectAccessScope } from '../projectAccessScope'

const persisted: ProjectAccessScope = { projectId: 'project-a', tenantId: 'tenant-a', organizationId: 'org-a' }
const freshSession: ProjectAccessScope = { projectId: 'project-a', tenantId: null, organizationId: null }

describe('bindProjectAccessScope', () => {
  it('continues an unchanged scope', () => {
    expect(bindProjectAccessScope(persisted, { ...persisted })).toEqual(persisted)
  })

  it.each([
    ['both cookies', freshSession],
    ['the tenant cookie', { ...persisted, tenantId: null }],
    ['the organization cookie', { ...persisted, organizationId: null }],
  ])('lets a fresh session adopt the scope persisted over %s', (_name, bound) => {
    expect(bindProjectAccessScope(bound, persisted)).toEqual(persisted)
  })

  it.each([
    ['organization', persisted, { ...persisted, organizationId: 'org-b' }],
    ['tenant', persisted, { ...persisted, tenantId: 'tenant-b' }],
    ['project', persisted, { ...persisted, projectId: 'project-b' }],
    ['project of a fresh session', freshSession, { ...persisted, projectId: 'project-b' }],
  ])('treats a changed %s as a new scope', (_name, bound, current) => {
    expect(bindProjectAccessScope(bound, current)).toBeNull()
  })

  it.each([
    ['organization', { ...persisted, organizationId: null }],
    ['tenant', { ...persisted, tenantId: null }],
  ])('treats a cleared %s cookie as a new scope', (_name, current) => {
    expect(bindProjectAccessScope(persisted, current)).toBeNull()
  })
})
