import {
  clearTenantExportExclusions,
  getTenantExportExclusion,
  listTenantExportExclusions,
  registerTenantExportExclusions,
} from '../tenant-export-exclusions'

describe('tenant export exclusion registry', () => {
  beforeEach(() => clearTenantExportExclusions())

  afterAll(() => clearTenantExportExclusions())

  it('registers module-owned tables with a default reason in stable order', () => {
    registerTenantExportExclusions({ module: 'auth', tables: ['sessions', 'password_resets'] })
    registerTenantExportExclusions({ module: 'sso', tables: ['scim_tokens'] })

    expect(listTenantExportExclusions()).toEqual([
      { module: 'auth', table: 'password_resets', reason: 'authentication-or-runtime-secret' },
      { module: 'sso', table: 'scim_tokens', reason: 'authentication-or-runtime-secret' },
      { module: 'auth', table: 'sessions', reason: 'authentication-or-runtime-secret' },
    ])
    expect(getTenantExportExclusion('sessions')?.module).toBe('auth')
    expect(getTenantExportExclusion('orders')).toBeNull()
  })

  it('lets the latest registration own a table', () => {
    registerTenantExportExclusions({ module: 'auth', tables: ['sessions'] })
    registerTenantExportExclusions({ module: 'security', tables: ['sessions'] })

    expect(getTenantExportExclusion('sessions')?.module).toBe('security')
    expect(listTenantExportExclusions()).toHaveLength(1)
  })

  it('rejects malformed registrations', () => {
    expect(() => registerTenantExportExclusions({ module: ' ', tables: ['sessions'] }))
      .toThrow('module is required')
    expect(() => registerTenantExportExclusions({ module: 'auth', tables: [] }))
      .toThrow('at least one table')
    expect(() => registerTenantExportExclusions({ module: 'auth', tables: ['"sessions"'] }))
      .toThrow('Invalid tenant export exclusion table name')
  })
})
