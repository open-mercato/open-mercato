import { bindProjectAccessScope, type ProjectAccessScope } from '../projectAccessScope'
import { readResolvedProjectAccessScope } from '../projectAccessScopeHeaders'

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
    expect(bindProjectAccessScope(bound, persisted, persisted)).toEqual(persisted)
  })

  it('does not adopt persisted cookies without a resolved server scope', () => {
    expect(bindProjectAccessScope(freshSession, persisted)).toBeNull()
  })

  it.each([
    ['organization', { ...persisted, organizationId: 'org-b' }],
    ['tenant', { ...persisted, tenantId: 'tenant-b' }],
  ])('rejects a first %s cookie that differs from the resolved server scope', (_name, current) => {
    expect(bindProjectAccessScope(freshSession, current, persisted)).toBeNull()
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

describe('readResolvedProjectAccessScope', () => {
  it('requires both resolved response headers', () => {
    expect(readResolvedProjectAccessScope({ headers: new Headers({
      'x-om-project-scope-tenant-id': 'tenant-a',
      'x-om-project-scope-organization-id': 'org-a',
    }) })).toEqual({ tenantId: 'tenant-a', organizationId: 'org-a' })
  })

  it.each(['x-om-project-scope-tenant-id', 'x-om-project-scope-organization-id'])('rejects a partial scope containing only %s', (header) => {
    expect(readResolvedProjectAccessScope({ headers: new Headers({ [header]: 'scope-a' }) })).toBeNull()
  })

  it('keeps a headerless response unresolved', () => {
    expect(readResolvedProjectAccessScope({})).toBeNull()
  })
})
