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
 *
 * PROFILES EXTENDED THIS, THEY DID NOT REPLACE IT. The four original variables
 * still mean exactly what they meant and still produce the same stored record;
 * `OM_INTEGRATION_ELEVENLABS_PROFILES` is additive, and the flat pair becomes
 * optional only when it is set (because the document can then carry the
 * `default` entry itself). A deployment that never heard of profiles behaves
 * byte-for-byte as before.
 */

import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { ELEVENLABS_INTEGRATION_ID } from '../integration'
import {
  listConfiguredProfileNames,
  parseElevenLabsCredentials,
  PROFILES_CREDENTIAL_KEY,
} from './credentials'

type ElevenLabsCredentialShape = {
  apiKey: string
  webhookSecret: string
  /**
   * The DEFAULT profile's pair. Optional since profiles arrived: a deployment
   * that ships `OM_INTEGRATION_ELEVENLABS_PROFILES` with a `default` entry has
   * already said which agent to dial. Set both, or neither.
   */
  agentId?: string
  agentPhoneNumberId?: string
  telephonyProvider: 'twilio' | 'sip_trunk'
  defaultCallerId?: string
  callRecordingEnabled?: boolean
  /**
   * Named profiles, stored as the same canonical JSON STRING an operator would
   * type into the admin form — deliberately not as a nested object, so a preset
   * and a form edit produce byte-identical stored records and neither surprises
   * whoever reads the other's output.
   */
  [PROFILES_CREDENTIAL_KEY]?: string
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
  /** JSON list/map of named profiles, in the shape the admin form's Call Profiles field takes. */
  profiles: ['OM_INTEGRATION_ELEVENLABS_PROFILES'],
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
  const profilesRaw = readEnvValue(env, OPTIONAL_ENV_KEYS.profiles)
  const anyProvided = Object.values(REQUIRED_ENV_KEYS).some((keys) => Boolean(readEnvValue(env, keys)))
    || Boolean(profilesRaw)
  if (!anyProvided) return null

  const apiKey = readEnvValue(env, REQUIRED_ENV_KEYS.apiKey)
  const webhookSecret = readEnvValue(env, REQUIRED_ENV_KEYS.webhookSecret)
  const agentId = readEnvValue(env, REQUIRED_ENV_KEYS.agentId)
  const agentPhoneNumberId = readEnvValue(env, REQUIRED_ENV_KEYS.agentPhoneNumberId)

  // The flat pair stays REQUIRED unless a profile document is supplied — that is
  // what keeps every deployment configured before profiles existed byte-identical.
  // With a document, the pair becomes optional because the document can carry the
  // `default` entry itself; the completeness check below then moves to "is there a
  // default at all", so a half-configured deployment still fails at deploy time
  // rather than on the first call.
  const requiresFlatPair = !profilesRaw
  if (!apiKey || !webhookSecret || (requiresFlatPair && (!agentId || !agentPhoneNumberId))) {
    // The names are listed, never the values — this message reaches logs.
    throw new Error(
      '[agent_elevenlabs] Incomplete ElevenLabs env preset. Set OM_INTEGRATION_ELEVENLABS_API_KEY, OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET, OM_INTEGRATION_ELEVENLABS_AGENT_ID and OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID.',
    )
  }
  if (Boolean(agentId) !== Boolean(agentPhoneNumberId)) {
    throw new Error(
      '[agent_elevenlabs] OM_INTEGRATION_ELEVENLABS_AGENT_ID and OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID must be set together — they are the two halves of the default call profile.',
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

  const credentials: ElevenLabsCredentialShape = {
    apiKey,
    webhookSecret,
    ...(agentId && agentPhoneNumberId ? { agentId, agentPhoneNumberId } : {}),
    telephonyProvider: telephonyProviderRaw === 'sip_trunk' ? 'sip_trunk' : 'twilio',
    ...(defaultCallerId ? { defaultCallerId } : {}),
    ...(callRecordingEnabled === undefined ? {} : { callRecordingEnabled }),
    ...(profilesRaw ? { [PROFILES_CREDENTIAL_KEY]: profilesRaw } : {}),
  }

  // Validate what we are about to store by running the SAME parser the connector
  // runs at dial time. A malformed profile document must fail the deploy, not the
  // first phone call thirty minutes into a workflow — and reusing the parser is
  // what stops the two notions of "valid" from drifting apart.
  assertPresetResolves(credentials)

  return {
    credentials,
    force: readBooleanEnv(env, OPTIONAL_ENV_KEYS.force) ?? false,
    // Default OFF. Placing outbound calls is the one capability in this package
    // with a consequence in the physical world, and T2.8 already made the ACL
    // grant default-off for the same reason; an env preset that silently enabled
    // the integration would be the one hole in that stance.
    enabled: readBooleanEnv(env, OPTIONAL_ENV_KEYS.enabled) ?? false,
  }
}

/**
 * Fail the deploy rather than the call.
 *
 * Rethrows the parser's own message with the ENV VARIABLE names attached, so an
 * operator reading a container log is told which variable to fix rather than
 * which admin-form field — they never opened the form. Nothing here echoes a
 * value: the parser's messages name fields and profile names only, and the two
 * secrets are not part of what it validates.
 */
function assertPresetResolves(credentials: ElevenLabsCredentialShape): void {
  try {
    parseElevenLabsCredentials(credentials as Record<string, unknown>)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[agent_elevenlabs] The ElevenLabs env preset does not resolve to a usable configuration: ${detail} (check OM_INTEGRATION_ELEVENLABS_PROFILES, OM_INTEGRATION_ELEVENLABS_AGENT_ID and OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID).`,
    )
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
        agentId: preset.credentials.agentId ?? null,
        // Names only — the profile bodies are non-secret but there is no reason
        // to copy provider ids into a log line to say a profile exists.
        profiles: listConfiguredProfileNames(preset.credentials as Record<string, unknown>),
      })
  }

  return { status: 'configured', enabled: preset.enabled }
}
