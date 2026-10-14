import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { integration } from '../integration'
import { resolveTpayNotificationUrl } from './callback-url'
import { resolveTpayEnvironment, type TpayEnvironment } from './tpay-client'

const TPAY_INTEGRATION_ID = 'gateway_tpay'

const ENV_KEYS = {
  clientId: 'OM_INTEGRATION_TPAY_CLIENT_ID',
  clientSecret: 'OM_INTEGRATION_TPAY_CLIENT_SECRET',
  environment: 'OM_INTEGRATION_TPAY_ENVIRONMENT',
  notificationUrl: 'OM_INTEGRATION_TPAY_NOTIFICATION_URL',
  notificationSecurityCode: 'OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE',
  enabled: 'OM_INTEGRATION_TPAY_ENABLED',
  force: 'OM_INTEGRATION_TPAY_FORCE_PRECONFIGURE',
} as const

type TpayCredentialShape = {
  clientId: string
  clientSecret: string
  environment: TpayEnvironment
  notificationUrl?: string
  notificationSecurityCode?: string
}

type TpayEnvPreset = {
  credentials: TpayCredentialShape
  force: boolean
  enabled: boolean
}

export type ApplyTpayPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; appliedApiVersion: string | null; enabled: boolean }

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function resolveDefaultApiVersion(): string | undefined {
  return integration.apiVersions?.find((version) => version.default)?.id
    ?? integration.apiVersions?.[0]?.id
}

function readEnvironment(env: NodeJS.ProcessEnv): TpayEnvironment {
  const raw = readEnvValue(env, ENV_KEYS.environment)
  if (raw === undefined) return 'sandbox'
  try {
    return resolveTpayEnvironment(raw)
  } catch {
    throw new Error(`[internal] [gateway_tpay] ${ENV_KEYS.environment} must be "sandbox" or "production".`)
  }
}

async function readNotificationUrl(
  env: NodeJS.ProcessEnv,
  environment: TpayEnvironment,
): Promise<string | undefined> {
  const raw = readEnvValue(env, ENV_KEYS.notificationUrl)
  if (raw === undefined) return undefined
  try {
    const resolved = await resolveTpayNotificationUrl({ credential: raw, environment })
    return resolved ?? undefined
  } catch {
    throw new Error(
      `[internal] [gateway_tpay] ${ENV_KEYS.notificationUrl} is not a valid Tpay notification URL for the ${environment} environment.`,
    )
  }
}

export async function readTpayEnvPreset(env: NodeJS.ProcessEnv = process.env): Promise<TpayEnvPreset | null> {
  const clientId = readEnvValue(env, ENV_KEYS.clientId)
  const clientSecret = readEnvValue(env, ENV_KEYS.clientSecret)
  if (!clientId && !clientSecret) {
    return null
  }
  if (!clientId || !clientSecret) {
    throw new Error(
      `[internal] [gateway_tpay] Incomplete Tpay env preset. Set both ${ENV_KEYS.clientId} and ${ENV_KEYS.clientSecret}.`,
    )
  }

  const environment = readEnvironment(env)
  const notificationUrl = await readNotificationUrl(env, environment)
  const notificationSecurityCode = readEnvValue(env, ENV_KEYS.notificationSecurityCode)

  return {
    credentials: {
      clientId,
      clientSecret,
      environment,
      ...(notificationUrl ? { notificationUrl } : {}),
      ...(notificationSecurityCode ? { notificationSecurityCode } : {}),
    },
    force: parseBooleanToken(env[ENV_KEYS.force]) ?? false,
    enabled: parseBooleanToken(env[ENV_KEYS.enabled]) ?? true,
  }
}

async function hasExistingTpayConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(TPAY_INTEGRATION_ID, scope),
    integrationStateService.get(TPAY_INTEGRATION_ID, scope),
  ])

  return Boolean(credentials) || Boolean(state)
}

export async function applyTpayEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyTpayPresetResult> {
  const preset = await readTpayEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Tpay preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingTpayConfiguration(params.credentialsService, params.integrationStateService, params.scope)) {
    return { status: 'skipped', reason: 'Tpay credentials or state already exist. Use force to overwrite them.' }
  }

  const resolvedApiVersion = resolveDefaultApiVersion() ?? null

  await params.credentialsService.save(TPAY_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    TPAY_INTEGRATION_ID,
    {
      isEnabled: preset.enabled,
      apiVersion: resolvedApiVersion ?? undefined,
    },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(TPAY_INTEGRATION_ID, params.scope).info(
      'Tpay integration was preconfigured from environment variables.',
      {
        enabled: preset.enabled,
        apiVersion: resolvedApiVersion,
        environment: preset.credentials.environment,
      },
    )
  }

  return {
    status: 'configured',
    appliedApiVersion: resolvedApiVersion,
    enabled: preset.enabled,
  }
}
