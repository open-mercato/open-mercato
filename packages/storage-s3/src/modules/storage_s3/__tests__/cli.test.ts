import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import {
  mapOrganizationsToScopes,
  parseCliArgs,
  resolveCliMode,
  runConfigureFromEnv,
  runConfigureFromEnvForScopes,
} from '../lib/configure-from-env'

function buildLogService() {
  const info = jest.fn()
  const integrationLogService = {
    scoped: jest.fn(() => ({ info })),
  } as unknown as IntegrationLogService
  return { integrationLogService, info }
}

describe('storage_s3 configure-from-env CLI handler', () => {
  it('skips when no env vars are set', async () => {
    const credentialsService = {
      getRaw: jest.fn(),
      save: jest.fn(),
    } as unknown as CredentialsService
    const { integrationLogService } = buildLogService()

    const outcome = await runConfigureFromEnv(
      { credentialsService, integrationLogService, env: {} },
      { tenantId: 't', organizationId: 'o' },
    )

    expect(outcome).toEqual({
      code: 0,
      status: 'skipped',
      message: expect.stringMatching(/No S3 env preset/),
    })
    expect(credentialsService.save).not.toHaveBeenCalled()
  })

  it('configures credentials with a complete env preset', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    } as unknown as CredentialsService
    const { integrationLogService, info } = buildLogService()

    const outcome = await runConfigureFromEnv(
      {
        credentialsService,
        integrationLogService,
        env: {
          OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
          OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
          OM_INTEGRATION_STORAGE_S3_REGION: 'eu-central-1',
          OM_INTEGRATION_STORAGE_S3_BUCKET: 'om-bucket',
        },
      },
      { tenantId: 't', organizationId: 'o' },
    )

    expect(outcome).toEqual({
      code: 0,
      status: 'configured',
      message: expect.stringMatching(/configured from env/i),
    })
    expect(credentialsService.save).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('skips when credentials already exist and --force is not set', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue({ accessKeyId: 'existing' }),
      save: jest.fn(),
    } as unknown as CredentialsService
    const { integrationLogService } = buildLogService()

    const outcome = await runConfigureFromEnv(
      {
        credentialsService,
        integrationLogService,
        env: {
          OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
          OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
          OM_INTEGRATION_STORAGE_S3_REGION: 'eu-central-1',
          OM_INTEGRATION_STORAGE_S3_BUCKET: 'om-bucket',
        },
      },
      { tenantId: 't', organizationId: 'o' },
    )

    expect(outcome).toEqual({
      code: 0,
      status: 'skipped',
      message: expect.stringMatching(/already exist/i),
    })
    expect(credentialsService.save).not.toHaveBeenCalled()
  })

  it('overwrites credentials when --force is true', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue({ accessKeyId: 'existing' }),
      save: jest.fn(),
    } as unknown as CredentialsService
    const { integrationLogService } = buildLogService()

    const outcome = await runConfigureFromEnv(
      {
        credentialsService,
        integrationLogService,
        env: {
          OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
          OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
          OM_INTEGRATION_STORAGE_S3_REGION: 'eu-central-1',
          OM_INTEGRATION_STORAGE_S3_BUCKET: 'om-bucket',
        },
      },
      { tenantId: 't', organizationId: 'o', force: true },
    )

    expect(outcome.code).toBe(0)
    expect(outcome.status).toBe('configured')
    expect(credentialsService.save).toHaveBeenCalledTimes(1)
  })

  it('returns code 1 with a clear message for incomplete env presets', async () => {
    const credentialsService = {
      getRaw: jest.fn(),
      save: jest.fn(),
    } as unknown as CredentialsService
    const { integrationLogService } = buildLogService()

    const outcome = await runConfigureFromEnv(
      {
        credentialsService,
        integrationLogService,
        env: {
          OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
          OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
        },
      },
      { tenantId: 't', organizationId: 'o' },
    )

    expect(outcome.code).toBe(1)
    expect(outcome.status).toBe('error')
    expect(outcome.message).toMatch(/Incomplete S3 env preset/)
    expect(credentialsService.save).not.toHaveBeenCalled()
  })
})

describe('storage_s3 configure-from-env --all-tenants helper', () => {
  function buildFullEnv() {
    return {
      OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
      OM_INTEGRATION_STORAGE_S3_REGION: 'eu-central-1',
      OM_INTEGRATION_STORAGE_S3_BUCKET: 'om-bucket',
    }
  }

  it('iterates every scope and reports per-scope outcomes', async () => {
    const existing = new Set(['org-existing'])
    const saved: Array<{ tenantId: string; organizationId: string }> = []

    const credentialsService = {
      getRaw: jest.fn(async (_id: string, scope: { tenantId: string; organizationId: string }) =>
        existing.has(scope.organizationId) ? { accessKeyId: 'existing' } : null,
      ),
      save: jest.fn(async (_id: string, _creds: unknown, scope: { tenantId: string; organizationId: string }) => {
        saved.push(scope)
      }),
    } as unknown as CredentialsService

    const { integrationLogService } = buildLogService()

    const summary = await runConfigureFromEnvForScopes(
      { credentialsService, integrationLogService, env: buildFullEnv() },
      [
        { tenantId: 't1', organizationId: 'org-fresh' },
        { tenantId: 't2', organizationId: 'org-existing' },
      ],
    )

    expect(summary).toMatchObject({ code: 0, configured: 1, skipped: 1, errored: 0 })
    expect(summary.perScope).toHaveLength(2)
    expect(summary.perScope[0].outcome.status).toBe('configured')
    expect(summary.perScope[1].outcome.status).toBe('skipped')
    expect(saved).toEqual([{ tenantId: 't1', organizationId: 'org-fresh' }])
  })

  it('returns exit code 1 when at least one scope errors', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (_id, _creds, scope) => {
        if ((scope as { organizationId: string }).organizationId === 'broken') {
          throw new Error('boom')
        }
      }),
    } as unknown as CredentialsService

    const { integrationLogService } = buildLogService()

    const summary = await runConfigureFromEnvForScopes(
      { credentialsService, integrationLogService, env: buildFullEnv() },
      [
        { tenantId: 't1', organizationId: 'ok' },
        { tenantId: 't2', organizationId: 'broken' },
      ],
    )

    expect(summary.code).toBe(1)
    expect(summary.configured).toBe(1)
    expect(summary.errored).toBe(1)
    expect(summary.perScope[1].outcome.status).toBe('error')
    expect((summary.perScope[1].outcome as { message: string }).message).toMatch(/boom/)
  })

  it('returns exit code 0 with skip-only outcomes when env is unset', async () => {
    const credentialsService = {
      getRaw: jest.fn(),
      save: jest.fn(),
    } as unknown as CredentialsService

    const { integrationLogService } = buildLogService()

    const summary = await runConfigureFromEnvForScopes(
      { credentialsService, integrationLogService, env: {} },
      [
        { tenantId: 't1', organizationId: 'a' },
        { tenantId: 't2', organizationId: 'b' },
      ],
    )

    expect(summary.code).toBe(0)
    expect(summary.skipped).toBe(2)
    expect(summary.configured).toBe(0)
    expect(summary.errored).toBe(0)
    expect(credentialsService.save).not.toHaveBeenCalled()
  })

  it('propagates --force to every scope', async () => {
    const saveCalls: Array<{ scope: { tenantId: string; organizationId: string } }> = []
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue({ accessKeyId: 'existing' }),
      save: jest.fn(async (_id, _creds, scope) => {
        saveCalls.push({ scope: scope as { tenantId: string; organizationId: string } })
      }),
    } as unknown as CredentialsService

    const { integrationLogService } = buildLogService()

    const summary = await runConfigureFromEnvForScopes(
      { credentialsService, integrationLogService, env: buildFullEnv() },
      [
        { tenantId: 't1', organizationId: 'a' },
        { tenantId: 't2', organizationId: 'b' },
      ],
      { force: true },
    )

    expect(summary.code).toBe(0)
    expect(summary.configured).toBe(2)
    expect(saveCalls).toHaveLength(2)
  })
})

describe('storage_s3 parseCliArgs', () => {
  it('parses standalone flags as boolean true', () => {
    expect(parseCliArgs(['--all-tenants'])).toEqual({ 'all-tenants': true })
    expect(parseCliArgs(['--force'])).toEqual({ force: true })
  })

  it('parses --key value pairs', () => {
    expect(parseCliArgs(['--tenant', 'abc', '--org', 'def'])).toEqual({
      tenant: 'abc',
      org: 'def',
    })
  })

  it('parses --key=value form', () => {
    expect(parseCliArgs(['--tenant=abc', '--org=def'])).toEqual({
      tenant: 'abc',
      org: 'def',
    })
  })

  it('treats the next --flag as a separate flag, not a value', () => {
    expect(parseCliArgs(['--all-tenants', '--force'])).toEqual({
      'all-tenants': true,
      force: true,
    })
  })

  it('ignores positional arguments without a leading --', () => {
    expect(parseCliArgs(['ignored', '--tenant', 'abc', 'also-ignored'])).toEqual({
      tenant: 'abc',
    })
  })
})

describe('storage_s3 resolveCliMode', () => {
  it('returns help when no tenant/org and no --all-tenants is provided', () => {
    expect(resolveCliMode({})).toEqual({ kind: 'help' })
    expect(resolveCliMode({ force: true })).toEqual({ kind: 'help' })
  })

  it('returns help when only --tenant is provided without --org', () => {
    expect(resolveCliMode({ tenant: 'abc' })).toEqual({ kind: 'help' })
  })

  it('returns help when only --org is provided without --tenant', () => {
    expect(resolveCliMode({ org: 'def' })).toEqual({ kind: 'help' })
  })

  it('returns single mode when both --tenant and --org are provided', () => {
    expect(resolveCliMode({ tenant: 'abc', org: 'def' })).toEqual({
      kind: 'single',
      tenantId: 'abc',
      organizationId: 'def',
      force: undefined,
    })
  })

  it('accepts the alias forms --tenantId / --organizationId / --orgId', () => {
    expect(resolveCliMode({ tenantId: 'abc', organizationId: 'def' })).toEqual({
      kind: 'single',
      tenantId: 'abc',
      organizationId: 'def',
      force: undefined,
    })
    expect(resolveCliMode({ tenant: 'abc', orgId: 'def' })).toEqual({
      kind: 'single',
      tenantId: 'abc',
      organizationId: 'def',
      force: undefined,
    })
  })

  it('propagates --force to single mode', () => {
    expect(resolveCliMode({ tenant: 'abc', org: 'def', force: true })).toEqual({
      kind: 'single',
      tenantId: 'abc',
      organizationId: 'def',
      force: true,
    })
  })

  it('returns all mode when --all-tenants is provided alone', () => {
    expect(resolveCliMode({ 'all-tenants': true })).toEqual({
      kind: 'all',
      force: undefined,
    })
  })

  it('accepts --allTenants as a camelCase alias for --all-tenants', () => {
    expect(resolveCliMode({ allTenants: true })).toEqual({
      kind: 'all',
      force: undefined,
    })
  })

  it('propagates --force to all mode', () => {
    expect(resolveCliMode({ 'all-tenants': true, force: true })).toEqual({
      kind: 'all',
      force: true,
    })
  })

  it('returns conflict when --all-tenants is combined with --tenant', () => {
    const mode = resolveCliMode({ 'all-tenants': true, tenant: 'abc' })
    expect(mode.kind).toBe('conflict')
    if (mode.kind === 'conflict') {
      expect(mode.message).toMatch(/cannot be combined/i)
    }
  })

  it('returns conflict when --all-tenants is combined with --org', () => {
    const mode = resolveCliMode({ 'all-tenants': true, org: 'def' })
    expect(mode.kind).toBe('conflict')
  })

  it('returns conflict when --all-tenants is combined with both --tenant and --org', () => {
    expect(resolveCliMode({ 'all-tenants': true, tenant: 'abc', org: 'def' }).kind).toBe('conflict')
  })
})

describe('storage_s3 mapOrganizationsToScopes', () => {
  it('returns an empty array when there are no organizations', () => {
    expect(mapOrganizationsToScopes([])).toEqual([])
  })

  it('returns a scope per organization with its tenant id', () => {
    const orgs = [
      { id: 'org-1', tenant: { id: 'tenant-1' } },
      { id: 'org-2', tenant: { id: 'tenant-1' } },
      { id: 'org-3', tenant: { id: 'tenant-2' } },
    ]
    expect(mapOrganizationsToScopes(orgs)).toEqual([
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      { tenantId: 'tenant-1', organizationId: 'org-2' },
      { tenantId: 'tenant-2', organizationId: 'org-3' },
    ])
  })

  it('skips organizations without a populated tenant (defensive guard)', () => {
    const orgs = [
      { id: 'org-1', tenant: { id: 'tenant-1' } },
      { id: 'org-2', tenant: null },
      { id: 'org-3' },
      { id: 'org-4', tenant: { id: null } },
      { id: 'org-5', tenant: { id: 'tenant-2' } },
    ]
    expect(mapOrganizationsToScopes(orgs)).toEqual([
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      { tenantId: 'tenant-2', organizationId: 'org-5' },
    ])
  })
})
