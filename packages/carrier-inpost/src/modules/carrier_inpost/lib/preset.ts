import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { inpostErrors } from './errors'

const INPOST_INTEGRATION_ID = 'carrier_inpost'

type InpostCredentialShape = {
  apiToken: string
  organizationId: string
  apiBaseUrl?: string
  webhookSecret?: string
}

type InpostEnvPreset = {
  credentials: InpostCredentialShape
  force: boolean
  enabled: boolean
}

export type ApplyInpostPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; enabled: boolean }

function readEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function readBooleanEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const parsed = parseBooleanToken(env[key])
    if (parsed !== null) return parsed
  }
  return undefined
}

export function readInpostEnvPreset(env: NodeJS.ProcessEnv = process.env): InpostEnvPreset | null {
  const credentialKeys = {
    apiToken: ['OM_INTEGRATION_INPOST_API_TOKEN'],
    organizationId: ['OM_INTEGRATION_INPOST_ORGANIZATION_ID'],
    apiBaseUrl: ['OM_INTEGRATION_INPOST_API_BASE_URL'],
    webhookSecret: ['OM_INTEGRATION_INPOST_WEBHOOK_SECRET'],
  } as const

  const anyCredentialProvided = [
    credentialKeys.apiToken,
    credentialKeys.organizationId,
  ].some((keys) => Boolean(readEnvValue(env, [...keys])))

  if (!anyCredentialProvided) {
    return null
  }

  const apiToken = readEnvValue(env, [...credentialKeys.apiToken])
  const organizationId = readEnvValue(env, [...credentialKeys.organizationId])

  if (!apiToken || !organizationId) {
    throw inpostErrors.incompleteEnvPreset()
  }

  const apiBaseUrl = readEnvValue(env, [...credentialKeys.apiBaseUrl])
  const webhookSecret = readEnvValue(env, [...credentialKeys.webhookSecret])

  return {
    credentials: {
      apiToken,
      organizationId,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
    },
    force: readBooleanEnv(env, ['OM_INTEGRATION_INPOST_FORCE_PRECONFIGURE']) ?? false,
    enabled: readBooleanEnv(env, ['OM_INTEGRATION_INPOST_ENABLED']) ?? true,
  }
}

async function hasExistingInpostConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(INPOST_INTEGRATION_ID, scope),
    integrationStateService.get(INPOST_INTEGRATION_ID, scope),
  ])

  return Boolean(credentials) || Boolean(state)
}

export async function applyInpostEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyInpostPresetResult> {
  const preset = readInpostEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No InPost preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingInpostConfiguration(params.credentialsService, params.integrationStateService, params.scope)) {
    return { status: 'skipped', reason: 'InPost credentials or state already exist. Use force to overwrite them.' }
  }

  await params.credentialsService.save(INPOST_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    INPOST_INTEGRATION_ID,
    { isEnabled: preset.enabled },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(INPOST_INTEGRATION_ID, params.scope).info(
      'InPost integration was preconfigured from environment variables.',
      { enabled: preset.enabled },
    )
  }

  return { status: 'configured', enabled: preset.enabled }
}
