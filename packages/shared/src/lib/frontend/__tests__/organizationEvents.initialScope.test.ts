/** @jest-environment jsdom */

type ScopeEvents = typeof import('../organizationEvents')

function loadEvents(): ScopeEvents {
  let events!: ScopeEvents
  jest.isolateModules(() => { events = require('../organizationEvents') as ScopeEvents })
  return events
}

describe('organization scope bootstrap', () => {
  beforeEach(() => {
    document.cookie = 'om_selected_org=; Max-Age=0; path=/'
    document.cookie = 'om_selected_tenant=; Max-Age=0; path=/'
  })

  it.each(['organization-one', '__all__'])('does not invalidate the persisted %s scope during switcher hydration', (selectedOrganization) => {
    document.cookie = `om_selected_org=${selectedOrganization}; path=/`
    document.cookie = 'om_selected_tenant=tenant-one; path=/'
    const events = loadEvents()
    const scope = { organizationId: selectedOrganization === '__all__' ? null : selectedOrganization, tenantId: 'tenant-one' }
    expect(events.getCurrentOrganizationScope()).toEqual(scope)
    const listener = jest.fn()
    const unsubscribe = events.subscribeOrganizationScopeChanged(listener)
    try {
      events.emitOrganizationScopeChanged(scope)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(events.getCurrentOrganizationScopeVersion()).toBe(0)
      events.emitOrganizationScopeChanged(scope)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally { unsubscribe() }
  })

  it.each([
    { organizationId: 'organization-two', tenantId: 'tenant-one' },
    { organizationId: 'organization-one', tenantId: 'tenant-two' },
  ])('invalidates cached definitions for an actual selection change to %j', (nextScope) => {
    document.cookie = 'om_selected_org=organization-one; path=/'
    document.cookie = 'om_selected_tenant=tenant-one; path=/'
    const events = loadEvents()
    events.emitOrganizationScopeChanged(nextScope)
    expect(events.getCurrentOrganizationScope()).toEqual(nextScope)
    expect(events.getCurrentOrganizationScopeVersion()).toBe(1)
  })

  it('preserves initial scope discovery when selection cookies are absent', () => {
    const events = loadEvents()
    expect(events.getCurrentOrganizationScope()).toEqual({ organizationId: null, tenantId: null })
    events.emitOrganizationScopeChanged({ organizationId: 'organization-one', tenantId: 'tenant-one' })
    expect(events.getCurrentOrganizationScopeVersion()).toBe(1)
  })

  it.each([
    ['', '', { organizationId: null, tenantId: null }],
    ['organization-one', '', { organizationId: 'organization-one', tenantId: null }],
    ['', 'tenant-one', { organizationId: null, tenantId: 'tenant-one' }],
  ])('handles empty or partial selection cookies %j / %j', (organization, tenant, expected) => {
    document.cookie = `om_selected_org=${organization}; path=/`
    document.cookie = `om_selected_tenant=${tenant}; path=/`
    expect(loadEvents().getCurrentOrganizationScope()).toEqual(expected)
  })

  it('reads encoded selection cookies without rejecting malformed escapes', () => {
    document.cookie = 'om_selected_org=organization%2Done; path=/'
    document.cookie = 'om_selected_tenant=tenant%bad; path=/'
    expect(loadEvents().getCurrentOrganizationScope()).toEqual({ organizationId: 'organization-one', tenantId: 'tenant%bad' })
  })
})
