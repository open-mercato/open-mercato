import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'

const AUTOPAY_INTEGRATION_ID = 'gateway_autopay'

type AutopayCredentialShape = {
  serviceId: string
  sharedKey: string
  hashAlgorithm?: string
  gatewayUrl: string
}

type AutopayEnvPreset = {
  credentials: AutopayCredentialShape
  force: boolean
  enabled: boolean
}

export type ApplyAutopayPresetResult =
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

/**
 * Reads sandbox/production Autopay credentials from env. There is no
 * publicly-usable default here (unlike some providers) — the sandbox
 * worked-example values (ServiceID=2, sharedKey=2test2) authenticate the
 * hash math only, never an actual redirect, per the `paytalk/autopay-sandbox`
 * reference project's own findings.
 */
export function readAutopayEnvPreset(env: NodeJS.ProcessEnv = process.env): AutopayEnvPreset | null {
  const credentialKeys = {
    serviceId: ['OM_INTEGRATION_AUTOPAY_SERVICE_ID'],
    sharedKey: ['OM_INTEGRATION_AUTOPAY_SHARED_KEY'],
    gatewayUrl: ['OM_INTEGRATION_AUTOPAY_GATEWAY_URL'],
  } as const

  const anyCredentialProvided = Object.values(credentialKeys).some((keys) => Boolean(readEnvValue(env, [...keys])))
  if (!anyCredentialProvided) {
    return null
  }

  const serviceId = readEnvValue(env, [...credentialKeys.serviceId])
  const sharedKey = readEnvValue(env, [...credentialKeys.sharedKey])
  const gatewayUrl = readEnvValue(env, [...credentialKeys.gatewayUrl])

  if (!serviceId || !sharedKey || !gatewayUrl) {
    throw new Error(
      '[gateway_autopay] Incomplete Autopay env preset. Set OM_INTEGRATION_AUTOPAY_SERVICE_ID, OM_INTEGRATION_AUTOPAY_SHARED_KEY, and OM_INTEGRATION_AUTOPAY_GATEWAY_URL.',
    )
  }

  const hashAlgorithm = readEnvValue(env, ['OM_INTEGRATION_AUTOPAY_HASH_ALGORITHM'])

  return {
    credentials: { serviceId, sharedKey, gatewayUrl, hashAlgorithm },
    force: readBooleanEnv(env, ['OM_INTEGRATION_AUTOPAY_FORCE_PRECONFIGURE']) ?? false,
    enabled: readBooleanEnv(env, ['OM_INTEGRATION_AUTOPAY_ENABLED']) ?? true,
  }
}

async function hasExistingAutopayConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(AUTOPAY_INTEGRATION_ID, scope),
    integrationStateService.get(AUTOPAY_INTEGRATION_ID, scope),
  ])

  return Boolean(credentials) || Boolean(state)
}

export async function applyAutopayEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyAutopayPresetResult> {
  const preset = readAutopayEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Autopay preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingAutopayConfiguration(params.credentialsService, params.integrationStateService, params.scope)) {
    return { status: 'skipped', reason: 'Autopay credentials or state already exist. Use force to overwrite them.' }
  }

  await params.credentialsService.save(AUTOPAY_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    AUTOPAY_INTEGRATION_ID,
    { isEnabled: preset.enabled },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(AUTOPAY_INTEGRATION_ID, params.scope).info(
      'Autopay integration was preconfigured from environment variables.',
      { enabled: preset.enabled },
    )
  }

  return { status: 'configured', enabled: preset.enabled }
}
