import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { integration } from '../integration'

const STRIPE_INTEGRATION_ID = 'gateway_stripe'

type StripeCredentialShape = {
  publishableKey: string
  secretKey: string
  webhookSecret: string
}

type StripeEnvPreset = {
  credentials: StripeCredentialShape
  force: boolean
  enabled: boolean
  apiVersion?: string
}

export type ApplyStripePresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; appliedApiVersion: string | null; enabled: boolean }

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

function resolveDefaultApiVersion(): string | undefined {
  return integration.apiVersions?.find((version) => version.default)?.id
    ?? integration.apiVersions?.[0]?.id
}

function ensureValidApiVersion(apiVersion: string): string {
  const knownVersions = integration.apiVersions?.map((version) => version.id) ?? []
  if (knownVersions.length === 0) return apiVersion
  if (knownVersions.includes(apiVersion)) return apiVersion
  throw new Error(
    `[gateway_stripe] Unsupported Stripe API version "${apiVersion}". Expected one of: ${knownVersions.join(', ')}.`,
  )
}

export function readStripeEnvPreset(env: NodeJS.ProcessEnv = process.env): StripeEnvPreset | null {
  const credentialKeys = {
    publishableKey: [
      'OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY',
      'OPENMERCATO_STRIPE_PUBLISHABLE_KEY',
      'STRIPE_PUBLISHABLE_KEY',
    ],
    secretKey: [
      'OM_INTEGRATION_STRIPE_SECRET_KEY',
      'OPENMERCATO_STRIPE_SECRET_KEY',
      'STRIPE_SECRET_KEY',
    ],
    webhookSecret: [
      'OM_INTEGRATION_STRIPE_WEBHOOK_SECRET',
      'OPENMERCATO_STRIPE_WEBHOOK_SECRET',
      'STRIPE_WEBHOOK_SECRET',
    ],
  } as const

  const anyCredentialProvided = Object.values(credentialKeys).some((keys) => Boolean(readEnvValue(env, [...keys])))
  if (!anyCredentialProvided) {
    return null
  }

  const publishableKey = readEnvValue(env, [...credentialKeys.publishableKey])
  const secretKey = readEnvValue(env, [...credentialKeys.secretKey])
  const webhookSecret = readEnvValue(env, [...credentialKeys.webhookSecret])

  if (!publishableKey || !secretKey || !webhookSecret) {
    throw new Error(
      '[gateway_stripe] Incomplete Stripe env preset. Set OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY, OM_INTEGRATION_STRIPE_SECRET_KEY, and OM_INTEGRATION_STRIPE_WEBHOOK_SECRET.',
    )
  }

  const apiVersion = readEnvValue(env, [
    'OM_INTEGRATION_STRIPE_API_VERSION',
    'OPENMERCATO_STRIPE_API_VERSION',
    'STRIPE_API_VERSION',
  ])

  return {
    credentials: {
      publishableKey,
      secretKey,
      webhookSecret,
    },
    force: readBooleanEnv(env, [
      'OM_INTEGRATION_STRIPE_FORCE_PRECONFIGURE',
      'OPENMERCATO_STRIPE_FORCE_PRECONFIGURE',
      'STRIPE_FORCE_PRECONFIGURE',
    ]) ?? false,
    enabled: readBooleanEnv(env, [
      'OM_INTEGRATION_STRIPE_ENABLED',
      'OPENMERCATO_STRIPE_ENABLED',
      'STRIPE_ENABLED',
    ]) ?? true,
    apiVersion: apiVersion ? ensureValidApiVersion(apiVersion) : undefined,
  }
}

async function hasExistingStripeConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(STRIPE_INTEGRATION_ID, scope),
    integrationStateService.get(STRIPE_INTEGRATION_ID, scope),
  ])

  return Boolean(credentials) || Boolean(state)
}

export async function applyStripeEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyStripePresetResult> {
  const preset = readStripeEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Stripe preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingStripeConfiguration(params.credentialsService, params.integrationStateService, params.scope)) {
    return { status: 'skipped', reason: 'Stripe credentials or state already exist. Use force to overwrite them.' }
  }

  const resolvedApiVersion = preset.apiVersion ?? resolveDefaultApiVersion() ?? null

  await params.credentialsService.save(STRIPE_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    STRIPE_INTEGRATION_ID,
    {
      isEnabled: preset.enabled,
      apiVersion: resolvedApiVersion ?? undefined,
    },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(STRIPE_INTEGRATION_ID, params.scope).info(
      'Stripe integration was preconfigured from environment variables.',
      {
        enabled: preset.enabled,
        apiVersion: resolvedApiVersion,
      },
    )
  }

  return {
    status: 'configured',
    appliedApiVersion: resolvedApiVersion,
    enabled: preset.enabled,
  }
}
