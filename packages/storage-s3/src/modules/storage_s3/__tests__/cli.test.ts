import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { runConfigureFromEnv } from '../lib/configure-from-env'

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
