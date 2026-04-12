import {
  QueryIndexScopeError,
  resolveQueryIndexRecordScope,
  resolveQueryIndexReindexScope,
} from '../lib/subscriber-scope'

describe('resolveQueryIndexRecordScope', () => {
  it('fills missing payload scope from the source row', () => {
    expect(
      resolveQueryIndexRecordScope({
        payloadTenantId: undefined,
        payloadOrganizationId: 'org-1',
        hasPayloadTenantId: false,
        hasPayloadOrganizationId: true,
        rowScope: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      })
    ).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('rejects tenant mismatches between payload and source row', () => {
    expect(() =>
      resolveQueryIndexRecordScope({
        payloadTenantId: 'tenant-b',
        payloadOrganizationId: 'org-1',
        hasPayloadTenantId: true,
        hasPayloadOrganizationId: true,
        rowScope: {
          tenantId: 'tenant-a',
          organizationId: 'org-1',
        },
      })
    ).toThrow(QueryIndexScopeError)
  })

  it('rejects organization mismatches between payload and source row', () => {
    expect(() =>
      resolveQueryIndexRecordScope({
        payloadTenantId: 'tenant-1',
        payloadOrganizationId: 'org-b',
        hasPayloadTenantId: true,
        hasPayloadOrganizationId: true,
        rowScope: {
          tenantId: 'tenant-1',
          organizationId: 'org-a',
        },
      })
    ).toThrow(QueryIndexScopeError)
  })

  it('rejects partial payload scope when the source row scope cannot be resolved', () => {
    expect(() =>
      resolveQueryIndexRecordScope({
        payloadTenantId: undefined,
        payloadOrganizationId: 'org-1',
        hasPayloadTenantId: false,
        hasPayloadOrganizationId: true,
        rowScope: null,
      })
    ).toThrow('missing tenantId/organizationId')
  })

  it('allows explicit full scope when the source row no longer exists', () => {
    expect(
      resolveQueryIndexRecordScope({
        payloadTenantId: 'tenant-1',
        payloadOrganizationId: 'org-1',
        hasPayloadTenantId: true,
        hasPayloadOrganizationId: true,
        rowScope: null,
      })
    ).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})

describe('resolveQueryIndexReindexScope', () => {
  it('rejects implicit all-tenant reindex payloads', () => {
    expect(() =>
      resolveQueryIndexReindexScope({
        tenantId: undefined,
        organizationId: undefined,
      })
    ).toThrow('all-tenant reindex must opt in')
  })

  it('allows explicit all-tenant reindex payloads', () => {
    expect(
      resolveQueryIndexReindexScope({
        tenantId: undefined,
        organizationId: undefined,
        allowAllTenants: true,
      })
    ).toEqual({
      tenantId: undefined,
      organizationId: undefined,
    })
  })

  it('preserves explicit global scope', () => {
    expect(
      resolveQueryIndexReindexScope({
        tenantId: null,
        organizationId: null,
      })
    ).toEqual({
      tenantId: null,
      organizationId: null,
    })
  })
})
