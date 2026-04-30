import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { S3StorageDriver } from './lib/s3-driver'
import { createStorageService } from './lib/storage-service'
import { s3HealthCheck } from './lib/health'

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

export function register(container: AppContainer) {
  // Register the S3 storage driver with the attachments driver factory (if present).
  // This keeps the AWS SDK entirely inside @open-mercato/storage-s3 and out of core.
  try {
    const factory = container.resolve('storageDriverFactory') as StorageDriverFactory
    factory.registerDriver('s3', (config) => new S3StorageDriver(config))
  } catch {
    // attachments module not enabled — S3 driver won't be available for attachment partitions.
  }

  container.register({
    s3HealthCheck: asValue(s3HealthCheck),
    storageService: asFunction(
      ({ integrationCredentialsService }: { integrationCredentialsService: IntegrationCredentialsService }) => {
        // StorageService factory — builds the service lazily using credentials
        // resolved from the Integration Marketplace per request.
        return {
          async _resolveService(scope: { tenantId: string; organizationId: string }) {
            const creds = await integrationCredentialsService.resolve('storage_s3', scope)
            if (!creds) throw new Error('S3 storage integration is not configured for this tenant.')
            return createStorageService({
              bucket: String(creds.bucket ?? ''),
              region: creds.region ? String(creds.region) : undefined,
              endpoint: creds.endpoint ? String(creds.endpoint) : undefined,
              forcePathStyle: Boolean(creds.forcePathStyle),
              // Credentials are resolved from the Integration Marketplace (encrypted at rest)
              // and injected directly rather than via env prefix for the standalone service.
            } as Parameters<typeof createStorageService>[0])
          },
        }
      },
    )
      .scoped()
      .proxy(),
  })
}
