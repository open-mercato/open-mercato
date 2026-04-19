import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createStorageService } from './lib/storage-service'

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

export function register(container: AppContainer) {
  container.register({
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
