import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerExternalStorageDriver,
  registerExternalCredentialEnhancer,
} from '@open-mercato/core/modules/attachments/lib/drivers'
import { S3StorageDriver } from './lib/s3-driver'
import { createStorageService } from './lib/storage-service'
import { s3HealthCheck } from './lib/health'

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

// Module-level registration — runs at import time, before any DI container is built.
// This avoids the singleton-proxy resolution issue when registering via DI.
registerExternalStorageDriver('s3', (config: Record<string, unknown>) => {
  console.log('[storage-s3] Creating S3StorageDriver with config:', {
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    hasAccessKey: Boolean(config.accessKeyId),
    hasCredentialsEnvPrefix: Boolean(config.credentialsEnvPrefix),
  })
  return new S3StorageDriver(config)
})

export function register(container: AppContainer) {
  // Register the credential enhancer via DI so it can access the request-scoped
  // integrationCredentialsService to inject marketplace credentials at upload time.
  registerExternalCredentialEnhancer('s3', async (config, scope) => {
    if (config.credentialsEnvPrefix || config.accessKeyId || config.authMode) return config
    try {
      const credsSvc = container.resolve('integrationCredentialsService') as IntegrationCredentialsService
      const creds = await credsSvc.resolve('storage_s3', scope)
      if (!creds) {
        console.log('[storage-s3] No marketplace credentials found for scope', scope)
        return config
      }
      console.log('[storage-s3] Injecting marketplace credentials into S3 driver config')
      return {
        authMode: creds.authMode,
        bucket: config.bucket ?? (creds.bucket ? String(creds.bucket) : undefined),
        region: config.region ?? (creds.region ? String(creds.region) : undefined),
        endpoint: config.endpoint ?? (creds.endpoint ? String(creds.endpoint) : undefined),
        forcePathStyle: config.forcePathStyle ?? Boolean(creds.forcePathStyle),
        accessKeyId: creds.accessKeyId ? String(creds.accessKeyId) : undefined,
        secretAccessKey: creds.secretAccessKey ? String(creds.secretAccessKey) : undefined,
        sessionToken: creds.sessionToken ? String(creds.sessionToken) : undefined,
      }
    } catch (err) {
      console.warn('[storage-s3] Credential enhancer failed, using partition config as-is:', err)
      return config
    }
  })

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
              authMode: creds.authMode === 'ambient' || creds.authMode === 'access_keys'
                ? (creds.authMode as 'ambient' | 'access_keys')
                : undefined,
              bucket: String(creds.bucket ?? ''),
              region: creds.region ? String(creds.region) : undefined,
              endpoint: creds.endpoint ? String(creds.endpoint) : undefined,
              forcePathStyle: Boolean(creds.forcePathStyle),
              accessKeyId: creds.accessKeyId ? String(creds.accessKeyId) : undefined,
              secretAccessKey: creds.secretAccessKey ? String(creds.secretAccessKey) : undefined,
              sessionToken: creds.sessionToken ? String(creds.sessionToken) : undefined,
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
