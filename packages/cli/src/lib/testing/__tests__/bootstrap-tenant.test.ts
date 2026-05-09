/**
 * Unit tests for the scriptable tenant-bootstrap wrapper that backs
 * `mercato test:bootstrap-tenant`. These tests cover argument parsing,
 * required-flag validation, slug-collision pre-check, and the JSON output
 * shape — i.e. the surface that downstream callers (staging-seeding loops,
 * sales-engineering demo provisioning, customer-onboarding scripts, DR
 * restores) actually depend on. The full end-to-end path through
 * `setupInitialTenant` is exercised by the existing CLI integration suite
 * against a real ephemeral DB.
 */

// Virtual mocks for the @open-mercato/core / @open-mercato/shared modules that
// `bootstrap-tenant.ts` lazy-imports — those packages aren't built in the
// `@open-mercato/cli` test workspace, mirroring the existing `mercato.test.ts`
// strategy.
jest.mock(
  '@open-mercato/core/modules/directory/data/entities',
  () => ({
    Tenant: class Tenant {},
    Organization: class Organization {},
  }),
  { virtual: true },
)
jest.mock(
  '@open-mercato/core/modules/auth/lib/setup-app',
  () => ({
    setupInitialTenant: jest.fn(),
  }),
  { virtual: true },
)
jest.mock(
  '@open-mercato/shared/modules/registry',
  () => ({
    getCliModules: jest.fn().mockReturnValue([]),
  }),
  { virtual: true },
)
jest.mock(
  '@open-mercato/shared/lib/di/container',
  () => ({
    createRequestContainer: jest.fn(),
  }),
  { virtual: true },
)

import {
  BOOTSTRAP_TENANT_USAGE,
  BootstrapTenantUsageError,
  TenantSlugExistsError,
  bootstrapTenant,
  parseBootstrapTenantArgs,
  runBootstrapTenant,
} from '../bootstrap-tenant'

const REQUIRED_ARGS = [
  '--slug',
  'acme',
  '--org-name',
  'Acme Corp',
  '--admin-email',
  'admin@acme.test',
  '--admin-password',
  'TopSecret!2026',
]

describe('parseBootstrapTenantArgs', () => {
  it('parses all required flags into a normalized shape', () => {
    const parsed = parseBootstrapTenantArgs(REQUIRED_ARGS)
    expect(parsed).toEqual({
      slug: 'acme',
      orgName: 'Acme Corp',
      adminEmail: 'admin@acme.test',
      adminPassword: 'TopSecret!2026',
      adminDisplayName: undefined,
      withExamples: false,
    })
  })

  it('accepts the optional --admin-display-name and trims whitespace', () => {
    const parsed = parseBootstrapTenantArgs([
      ...REQUIRED_ARGS,
      '--admin-display-name',
      '  Director of Operations  ',
    ])
    expect(parsed.adminDisplayName).toBe('Director of Operations')
  })

  it('treats --with-examples as a boolean toggle (off by default, on when present)', () => {
    expect(parseBootstrapTenantArgs(REQUIRED_ARGS).withExamples).toBe(false)
    expect(
      parseBootstrapTenantArgs([...REQUIRED_ARGS, '--with-examples']).withExamples,
    ).toBe(true)
  })

  it('supports inline `--key=value` form alongside the space-separated form', () => {
    const parsed = parseBootstrapTenantArgs([
      '--slug=acme-2',
      '--org-name=Acme Two',
      '--admin-email=admin@acme.test',
      '--admin-password=TopSecret!2026',
    ])
    expect(parsed.slug).toBe('acme-2')
    expect(parsed.orgName).toBe('Acme Two')
  })

  it('also accepts the legacy camelCase aliases used elsewhere in the CLI', () => {
    const parsed = parseBootstrapTenantArgs([
      '--slug',
      'acme',
      '--orgName',
      'Acme Corp',
      '--adminEmail',
      'admin@acme.test',
      '--adminPassword',
      'TopSecret!2026',
    ])
    expect(parsed.orgName).toBe('Acme Corp')
    expect(parsed.adminEmail).toBe('admin@acme.test')
    expect(parsed.adminPassword).toBe('TopSecret!2026')
  })

  describe('required-flag validation', () => {
    const requiredFlags: Array<{ remove: string; expect: string }> = [
      { remove: '--slug', expect: '--slug' },
      { remove: '--org-name', expect: '--org-name' },
      { remove: '--admin-email', expect: '--admin-email' },
      { remove: '--admin-password', expect: '--admin-password' },
    ]

    for (const { remove, expect: missingFlag } of requiredFlags) {
      it(`fails with a clear usage error when ${remove} is missing`, () => {
        const args = [...REQUIRED_ARGS]
        const idx = args.indexOf(remove)
        // Drop the flag and its value
        args.splice(idx, 2)
        expect(() => parseBootstrapTenantArgs(args)).toThrow(BootstrapTenantUsageError)
        try {
          parseBootstrapTenantArgs(args)
        } catch (err) {
          expect((err as Error).message).toContain(missingFlag)
          expect((err as Error).message).toContain(BOOTSTRAP_TENANT_USAGE)
        }
      })
    }

    it('fails when the entire arg list is empty', () => {
      expect(() => parseBootstrapTenantArgs([])).toThrow(BootstrapTenantUsageError)
    })
  })
})

describe('bootstrapTenant — slug-collision pre-check', () => {
  it('throws TenantSlugExistsError when an organization with that slug already exists', async () => {
    const findOne = jest
      .fn()
      // Organization lookup hit — slug is taken
      .mockResolvedValueOnce({ id: 'existing-org', slug: 'acme' })
    const em = { findOne } as any

    await expect(
      bootstrapTenant(em, {
        slug: 'acme',
        orgName: 'Acme Corp',
        adminEmail: 'admin@acme.test',
        adminPassword: 'TopSecret!2026',
        withExamples: false,
      }),
    ).rejects.toBeInstanceOf(TenantSlugExistsError)
  })

  it('throws TenantSlugExistsError when a tenant synthesized name `${slug} Tenant` already exists', async () => {
    const findOne = jest
      .fn()
      // Organization lookup miss
      .mockResolvedValueOnce(null)
      // Tenant lookup hit on synthesized name
      .mockResolvedValueOnce({ id: 'existing-tenant', name: 'acme Tenant' })
    const em = { findOne } as any

    await expect(
      bootstrapTenant(em, {
        slug: 'acme',
        orgName: 'Acme Corp',
        adminEmail: 'admin@acme.test',
        adminPassword: 'TopSecret!2026',
        withExamples: false,
      }),
    ).rejects.toBeInstanceOf(TenantSlugExistsError)
  })
})

describe('runBootstrapTenant — JSON stdout contract', () => {
  let originalExitCode: number | string | undefined
  let stdoutSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance

  beforeEach(() => {
    originalExitCode = process.exitCode
    process.exitCode = undefined
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('writes a single JSON line to stderr with usage and exits non-zero when args are missing', async () => {
    await runBootstrapTenant([])
    expect(process.exitCode).toBe(2)
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy).toHaveBeenCalled()
    const stderrPayload = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrPayload).toContain('--slug')
    expect(stderrPayload).toContain(BOOTSTRAP_TENANT_USAGE)
  })
})
