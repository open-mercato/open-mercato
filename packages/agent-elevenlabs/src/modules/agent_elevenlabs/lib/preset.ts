/**
 * Provider-owned env preconfiguration.
 *
 * The rule (`integrations/AGENTS.md`) is that a deployment-managed integration
 * reads ITS OWN env vars in ITS OWN package — core never learns a provider's
 * variable names. Same shape as `gateway_stripe`'s preset so the two are
 * learnable as one pattern:
 *
 *   - no variables set        → `null`, a silent no-op (the normal case)
 *   - some but not all set    → THROW, because a half-configured integration
 *                               that appears configured is worse than an absent
 *                               one: the first workflow to reach the voice node
 *                               would fail mid-run instead of at deploy time
 *   - already configured      → skip unless forced, so a redeploy never
 *                               overwrites a secret an operator rotated in the UI
 */

import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { ELEVENLABS_INTEGRATION_ID } from '../integration'

type ElevenLabsCredentialShape = {
  apiKey: string
  webhookSecret: string
  agentId: string
  agentPhoneNumberId: string
  telephonyProvider: 'twilio' | 'sip_trunk'
  defaultCallerId?: string
  callRecordingEnabled?: boolean
}

type ElevenLabsEnvPreset = {
  credentials: ElevenLabsCredentialShape
  force: boolean
  enabled: boolean
}

export type ApplyElevenLabsPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; enabled: boolean }

const REQUIRED_ENV_KEYS = {
  apiKey: ['OM_INTEGRATION_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY'],
  webhookSecret: ['OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET', 'ELEVENLABS_WEBHOOK_SECRET'],
  agentId: ['OM_INTEGRATION_ELEVENLABS_AGENT_ID', 'ELEVENLABS_AGENT_ID'],
  agentPhoneNumberId: [
    'OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID',
    'ELEVENLABS_PHONE_NUMBER_ID',
  ],
} as const

const OPTIONAL_ENV_KEYS = {
  telephonyProvider: ['OM_INTEGRATION_ELEVENLABS_TELEPHONY_PROVIDER'],
  defaultCallerId: ['OM_INTEGRATION_ELEVENLABS_DEFAULT_CALLER_ID'],
  callRecordingEnabled: ['OM_INTEGRATION_ELEVENLABS_CALL_RECORDING_ENABLED'],
  enabled: ['OM_INTEGRATION_ELEVENLABS_ENABLED'],
  force: ['OM_INTEGRATION_ELEVENLABS_FORCE_PRECONFIGURE'],
} as const

export const ELEVENLABS_ENV_KEYS = { ...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS }

function readEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function readBooleanEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const parsed = parseBooleanToken(env[key])
    if (parsed !== null) return parsed
  }
  return undefined
}

export function readElevenLabsEnvPreset(
  env: NodeJS.ProcessEnv = process.env,
): ElevenLabsEnvPreset | null {
  const anyProvided = Object.values(REQUIRED_ENV_KEYS).some((keys) => Boolean(readEnvValue(env, keys)))
  if (!anyProvided) return null

  const apiKey = readEnvValue(env, REQUIRED_ENV_KEYS.apiKey)
  const webhookSecret = readEnvValue(env, REQUIRED_ENV_KEYS.webhookSecret)
  const agentId = readEnvValue(env, REQUIRED_ENV_KEYS.agentId)
  const agentPhoneNumberId = readEnvValue(env, REQUIRED_ENV_KEYS.agentPhoneNumberId)

  if (!apiKey || !webhookSecret || !agentId || !agentPhoneNumberId) {
    // The names are listed, never the values — this message reaches logs.
    throw new Error(
      '[agent_elevenlabs] Incomplete ElevenLabs env preset. Set OM_INTEGRATION_ELEVENLABS_API_KEY, OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET, OM_INTEGRATION_ELEVENLABS_AGENT_ID and OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID.',
    )
  }

  const telephonyProviderRaw = readEnvValue(env, OPTIONAL_ENV_KEYS.telephonyProvider)
  if (telephonyProviderRaw && telephonyProviderRaw !== 'twilio' && telephonyProviderRaw !== 'sip_trunk') {
    throw new Error(
      `[agent_elevenlabs] Unsupported OM_INTEGRATION_ELEVENLABS_TELEPHONY_PROVIDER "${telephonyProviderRaw}". Expected "twilio" or "sip_trunk".`,
    )
  }
  const defaultCallerId = readEnvValue(env, OPTIONAL_ENV_KEYS.defaultCallerId)
  const callRecordingEnabled = readBooleanEnv(env, OPTIONAL_ENV_KEYS.callRecordingEnabled)

  return {
    credentials: {
      apiKey,
      webhookSecret,
      agentId,
      agentPhoneNumberId,
      telephonyProvider: telephonyProviderRaw === 'sip_trunk' ? 'sip_trunk' : 'twilio',
      ...(defaultCallerId ? { defaultCallerId } : {}),
      ...(callRecordingEnabled === undefined ? {} : { callRecordingEnabled }),
    },
    force: readBooleanEnv(env, OPTIONAL_ENV_KEYS.force) ?? false,
    // Default OFF. Placing outbound calls is the one capability in this package
    // with a consequence in the physical world, and T2.8 already made the ACL
    // grant default-off for the same reason; an env preset that silently enabled
    // the integration would be the one hole in that stance.
    enabled: readBooleanEnv(env, OPTIONAL_ENV_KEYS.enabled) ?? false,
  }
}

async function hasExistingConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(ELEVENLABS_INTEGRATION_ID, scope),
    integrationStateService.get(ELEVENLABS_INTEGRATION_ID, scope),
  ])
  return Boolean(credentials) || Boolean(state)
}

export async function applyElevenLabsEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyElevenLabsPresetResult> {
  const preset = readElevenLabsEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No ElevenLabs preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (
    !force
    && (await hasExistingConfiguration(params.credentialsService, params.integrationStateService, params.scope))
  ) {
    return {
      status: 'skipped',
      reason: 'ElevenLabs credentials or state already exist. Use force to overwrite them.',
    }
  }

  await params.credentialsService.save(ELEVENLABS_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    ELEVENLABS_INTEGRATION_ID,
    { isEnabled: preset.enabled },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService
      .scoped(ELEVENLABS_INTEGRATION_ID, params.scope)
      .info('ElevenLabs integration was preconfigured from environment variables.', {
        enabled: preset.enabled,
        agentId: preset.credentials.agentId,
      })
  }

  return { status: 'configured', enabled: preset.enabled }
}
