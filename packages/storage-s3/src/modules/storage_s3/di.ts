import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { getRequestScopeContainer, runInRequestScope } from '@open-mercato/shared/lib/di/request-scope'
import {
  registerExternalStorageDriver,
  registerStorageDriverValidator,
  getAttachmentStoragePolicy,
  registerExternalCredentialEnhancer,
} from '@open-mercato/core/modules/attachments/lib/drivers'
import { validateS3StorageConfiguration } from './lib/storage-validation'
import { S3StorageDriver } from './lib/s3-driver'
import { buildTenantS3DriverConfig } from './lib/tenant-credentials'
import { createStorageService } from './lib/storage-service'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { s3HealthCheck } from './lib/health'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { scheduleStorageS3QuotaRecovery } from './lib/quota-recovery-queue'

const logger = createLogger('storage_s3')

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

// Module-level registration — runs at import time, before any DI container is built.
// This avoids the singleton-proxy resolution issue when registering via DI.
registerStorageDriverValidator('s3', validateS3StorageConfiguration)
registerExternalStorageDriver('s3', (config: Record<string, unknown>) => {
  logger.debug('Creating S3StorageDriver', {
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    hasAccessKey: Boolean(config.accessKeyId),
    hasCredentialsEnvPrefix: Boolean(config.credentialsEnvPrefix),
  })
  return new S3StorageDriver(config)
})

function registerCredentialEnhancer(
  resolveCredentials: (scope: { tenantId: string; organizationId: string }) => Promise<Record<string, unknown> | null>,
) {
  registerExternalCredentialEnhancer('s3', async (config, scope) => {
    const scopedConfig = {
      ...config,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    }
    if (config.credentialsEnvPrefix || config.accessKeyId || config.authMode) return scopedConfig
    try {
      const creds = await resolveCredentials(scope)
      if (!creds) {
        logger.debug('No marketplace credentials found for scope', { tenantId: scope.tenantId, organizationId: scope.organizationId })
        return scopedConfig
      }
      const tenantConfig = buildTenantS3DriverConfig(creds, scope)
      if (!tenantConfig) throw new Error('[internal] Tenant S3 storage requires explicit access keys')
      logger.debug('Injecting marketplace credentials into S3 driver config')
      return {
        ...tenantConfig,
        bucket: config.bucket ?? tenantConfig.bucket,
        region: config.region ?? tenantConfig.region,
        endpoint: config.endpoint ?? tenantConfig.endpoint,
        forcePathStyle: config.forcePathStyle ?? tenantConfig.forcePathStyle,
      }
    } catch (err) {
      if (getAttachmentStoragePolicy() === 'strict') throw err
      logger.warn('Credential enhancer failed, using scoped partition config', { err })
      return scopedConfig
    }
  })
}

function registerServices(container: AppContainer) {
  container.register({
    s3HealthCheck: asValue(s3HealthCheck),
    storageS3QuotaRecoveryScheduler: asValue(scheduleStorageS3QuotaRecovery),
    storageService: asFunction(
      ({ integrationCredentialsService, attachmentQuotaService, storageS3QuotaRecoveryScheduler }: {
        integrationCredentialsService: IntegrationCredentialsService
        attachmentQuotaService: AttachmentQuotaService
        storageS3QuotaRecoveryScheduler: (
          payload: { reservationId: string; tenantId: string; organizationId: string },
          delayMs: number,
        ) => Promise<void>
      }) => {
        // StorageService factory — builds the service lazily using credentials
        // resolved from the Integration Marketplace per request.
        return {
          async _resolveService(scope: { tenantId: string; organizationId: string }) {
            const creds = await integrationCredentialsService.resolve('storage_s3', scope)
            if (!creds) throw new Error('[internal] S3 storage integration is not configured for this tenant.')
            const tenantConfig = buildTenantS3DriverConfig(creds, scope)
            if (!tenantConfig) throw new Error('[internal] Tenant S3 storage requires explicit access keys')
            return createStorageService({
              ...tenantConfig,
              quotaService: attachmentQuotaService,
              quotaRecoveryScheduler: storageS3QuotaRecoveryScheduler,
            })
          },
        }
      },
    )
      .scoped()
      .proxy(),
  })
}


function registerLegacy(container: AppContainer) {
  registerCredentialEnhancer((scope) =>
    container.resolve<IntegrationCredentialsService>('integrationCredentialsService').resolve('storage_s3', scope))
  registerServices(container)
}

async function resolveCurrentCredentials(scope: { tenantId: string; organizationId: string }) {
  const active = getRequestScopeContainer()
  if (active) return active.resolve<IntegrationCredentialsService>('integrationCredentialsService').resolve('storage_s3', scope)
  return runInRequestScope(async () => {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const caller = await createRequestContainer()
    try {
      return await caller.resolve<IntegrationCredentialsService>('integrationCredentialsService').resolve('storage_s3', scope)
    } finally {
      await caller.dispose()
    }
  })
}

export const register = defineProcessDiRegistrar((container: AppContainer) => {
  registerServices(container)
  registerProcessActivation(container, () => registerCredentialEnhancer(resolveCurrentCredentials))
}, { legacy: registerLegacy })
