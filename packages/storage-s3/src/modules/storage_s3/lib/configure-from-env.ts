import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { applyS3EnvPreset, readS3EnvPreset } from './preset'

export type ConfigureFromEnvDeps = {
  credentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  env?: NodeJS.ProcessEnv
}

export type ConfigureFromEnvOptions = {
  tenantId: string
  organizationId: string
  force?: boolean
}

export type ConfigureFromEnvOutcome =
  | { code: 0; status: 'configured' | 'skipped'; message: string }
  | { code: 1; status: 'error'; message: string }

export async function runConfigureFromEnv(
  deps: ConfigureFromEnvDeps,
  options: ConfigureFromEnvOptions,
): Promise<ConfigureFromEnvOutcome> {
  try {
    const preset = readS3EnvPreset(deps.env ?? process.env)
    if (!preset) {
      return {
        code: 0,
        status: 'skipped',
        message: 'No S3 env preset was found. Set OM_INTEGRATION_STORAGE_S3_* variables to enable preconfiguration.',
      }
    }

    const result = await applyS3EnvPreset({
      credentialsService: deps.credentialsService,
      integrationLogService: deps.integrationLogService,
      scope: { tenantId: options.tenantId, organizationId: options.organizationId },
      force: options.force,
      env: deps.env ?? process.env,
    })

    if (result.status === 'skipped') {
      return { code: 0, status: 'skipped', message: result.reason }
    }

    return { code: 0, status: 'configured', message: 'S3 credentials were configured from env.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown S3 preset error'
    return { code: 1, status: 'error', message }
  }
}
