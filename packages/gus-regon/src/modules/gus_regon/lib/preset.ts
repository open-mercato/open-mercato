import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { GUS_REGON_INTEGRATION_ID } from './config'
import type { GusEnvironment } from './types'

const ENV_KEYS = {
  apiKey: 'OM_INTEGRATION_GUS_REGON_API_KEY',
  environment: 'OM_INTEGRATION_GUS_REGON_ENVIRONMENT',
  showOnCompanyForms: 'OM_INTEGRATION_GUS_REGON_SHOW_ON_COMPANY_FORMS',
  enabled: 'OM_INTEGRATION_GUS_REGON_ENABLED',
  force: 'OM_INTEGRATION_GUS_REGON_FORCE_PRECONFIGURE',
} as const

export type GusRegonEnvPreset = {
  credentials: {
    environment: GusEnvironment
    apiKey: string
    showOnCompanyForms: boolean
  }
  force: boolean
  enabled: boolean
}

export type ApplyGusRegonPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; enabled: boolean }

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function readEnvironment(env: NodeJS.ProcessEnv): GusEnvironment {
  const raw = readEnvValue(env, ENV_KEYS.environment)
  if (raw === undefined) return 'test'
  if (raw === 'test' || raw === 'production') return raw
  throw new Error(`[internal] [gus_regon] ${ENV_KEYS.environment} must be "test" or "production".`)
}

/**
 * Reads the provider preset from env. The API key is the trigger: without it
 * nothing is preconfigured, so a deployment opts in explicitly.
 */
export function readGusRegonEnvPreset(env: NodeJS.ProcessEnv = process.env): GusRegonEnvPreset | null {
  const apiKey = readEnvValue(env, ENV_KEYS.apiKey)
  if (!apiKey) return null

  return {
    credentials: {
      environment: readEnvironment(env),
      apiKey,
      showOnCompanyForms: parseBooleanToken(env[ENV_KEYS.showOnCompanyForms]) ?? false,
    },
    force: parseBooleanToken(env[ENV_KEYS.force]) ?? false,
    enabled: parseBooleanToken(env[ENV_KEYS.enabled]) ?? true,
  }
}

async function hasExistingConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(GUS_REGON_INTEGRATION_ID, scope),
    integrationStateService.get(GUS_REGON_INTEGRATION_ID, scope),
  ])
  return Boolean(credentials) || Boolean(state)
}

export async function applyGusRegonEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyGusRegonPresetResult> {
  const preset = readGusRegonEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No GUS REGON preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingConfiguration(params.credentialsService, params.integrationStateService, params.scope)) {
    return { status: 'skipped', reason: 'GUS REGON credentials or state already exist. Use force to overwrite them.' }
  }

  await params.credentialsService.save(GUS_REGON_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(GUS_REGON_INTEGRATION_ID, { isEnabled: preset.enabled }, params.scope)

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(GUS_REGON_INTEGRATION_ID, params.scope).info(
      'GUS REGON integration was preconfigured from environment variables.',
      {
        enabled: preset.enabled,
        environment: preset.credentials.environment,
        showOnCompanyForms: preset.credentials.showOnCompanyForms,
      },
    )
  }

  return { status: 'configured', enabled: preset.enabled }
}
