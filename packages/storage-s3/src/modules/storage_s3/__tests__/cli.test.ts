import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import {
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
