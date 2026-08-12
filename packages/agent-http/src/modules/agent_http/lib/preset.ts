/**
 * Provider-owned env preconfiguration.
 *
 * The rule (`integrations/AGENTS.md`) is that a deployment-managed integration
 * reads ITS OWN env vars in ITS OWN package — core never learns a provider's
 * variable names. Same shape as `gateway_stripe`'s and `agent_elevenlabs`'s
 * presets so all three are learnable as one pattern:
 *
 *   - no variables set        → `null`, a silent no-op (the normal case)
 *   - some but not all set    → THROW, because a half-configured integration that
 *                               appears configured is worse than an absent one:
 *                               the first workflow to reach the agent node would
 *                               fail mid-run instead of at deploy time
 *   - already configured      → skip unless forced, so a redeploy never overwrites
 *                               a secret an operator rotated in the UI
 *
 * The preset validates what it is about to store by running the SAME parser the
 * connector runs at start time, so a malformed body template fails the deploy
 * rather than the first run.
 */

import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { AGENT_HTTP_INTEGRATION_ID } from '../integration'
import {
  parseGenericHttpCredentials,
  REQUEST_TEMPLATE_CREDENTIAL_KEY,
  type GenericHttpSignatureScheme,
} from './credentials'

type GenericHttpCredentialShape = {
  startUrl: string
  signingSecret: string
  authHeaderName?: string
  authHeaderValue?: string
  signatureHeader?: string
  signatureScheme?: GenericHttpSignatureScheme
  resultPath?: string
  externalRunIdPath?: string
  /**
   * The template is stored as the same canonical JSON STRING an operator would
   * type into the admin form — deliberately not as a nested object, so a preset
   * and a form edit produce byte-identical stored records.
   */
  [REQUEST_TEMPLATE_CREDENTIAL_KEY]?: string
}

type GenericHttpEnvPreset = {
  credentials: GenericHttpCredentialShape
  force: boolean
  enabled: boolean
}

export type ApplyGenericHttpPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; enabled: boolean }

const REQUIRED_ENV_KEYS = {
  startUrl: ['OM_INTEGRATION_AGENT_HTTP_START_URL'],
  signingSecret: ['OM_INTEGRATION_AGENT_HTTP_SIGNING_SECRET'],
} as const

const OPTIONAL_ENV_KEYS = {
  authHeaderName: ['OM_INTEGRATION_AGENT_HTTP_AUTH_HEADER_NAME'],
  authHeaderValue: ['OM_INTEGRATION_AGENT_HTTP_AUTH_HEADER_VALUE'],
  signatureHeader: ['OM_INTEGRATION_AGENT_HTTP_SIGNATURE_HEADER'],
  signatureScheme: ['OM_INTEGRATION_AGENT_HTTP_SIGNATURE_SCHEME'],
  resultPath: ['OM_INTEGRATION_AGENT_HTTP_RESULT_PATH'],
  externalRunIdPath: ['OM_INTEGRATION_AGENT_HTTP_EXTERNAL_RUN_ID_PATH'],
  requestTemplate: ['OM_INTEGRATION_AGENT_HTTP_REQUEST_TEMPLATE'],
  enabled: ['OM_INTEGRATION_AGENT_HTTP_ENABLED'],
  force: ['OM_INTEGRATION_AGENT_HTTP_FORCE_PRECONFIGURE'],
} as const

export const AGENT_HTTP_ENV_KEYS = { ...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS }

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

export function readGenericHttpEnvPreset(
  env: NodeJS.ProcessEnv = process.env,
): GenericHttpEnvPreset | null {
  const startUrl = readEnvValue(env, REQUIRED_ENV_KEYS.startUrl)
  const signingSecret = readEnvValue(env, REQUIRED_ENV_KEYS.signingSecret)
  const anyProvided = Boolean(startUrl) || Boolean(signingSecret)
  if (!anyProvided) return null

  if (!startUrl || !signingSecret) {
    // The names are listed, never the values — this message reaches logs.
    throw new Error(
      '[agent_http] Incomplete HTTP agent env preset. Set OM_INTEGRATION_AGENT_HTTP_START_URL and OM_INTEGRATION_AGENT_HTTP_SIGNING_SECRET.',
    )
  }

  const signatureScheme = readPresetSignatureScheme(
    readEnvValue(env, OPTIONAL_ENV_KEYS.signatureScheme),
  )

  const credentials: GenericHttpCredentialShape = {
    startUrl,
    signingSecret,
    ...optional('authHeaderName', readEnvValue(env, OPTIONAL_ENV_KEYS.authHeaderName)),
    ...optional('authHeaderValue', readEnvValue(env, OPTIONAL_ENV_KEYS.authHeaderValue)),
    ...optional('signatureHeader', readEnvValue(env, OPTIONAL_ENV_KEYS.signatureHeader)),
    ...(signatureScheme ? { signatureScheme } : {}),
    ...optional('resultPath', readEnvValue(env, OPTIONAL_ENV_KEYS.resultPath)),
    ...optional('externalRunIdPath', readEnvValue(env, OPTIONAL_ENV_KEYS.externalRunIdPath)),
    ...optional(REQUEST_TEMPLATE_CREDENTIAL_KEY, readEnvValue(env, OPTIONAL_ENV_KEYS.requestTemplate)),
  }

  assertPresetResolves(credentials)

  return {
    credentials,
    force: readBooleanEnv(env, OPTIONAL_ENV_KEYS.force) ?? false,
    // Default OFF, matching the sibling voice integration: an external agent
    // reaches out of the deployment on a schedule nobody watches, and T2.8 already
    // made the ACL grant default-off for the same reason. An env preset that
    // silently enabled the integration would be the one hole in that stance.
    enabled: readBooleanEnv(env, OPTIONAL_ENV_KEYS.enabled) ?? false,
  }
}

function readPresetSignatureScheme(raw: string | undefined): GenericHttpSignatureScheme | undefined {
  if (!raw) return undefined
  if (raw === 'hex' || raw === 'sha256_prefix') return raw
  throw new Error(
    `[agent_http] Unsupported OM_INTEGRATION_AGENT_HTTP_SIGNATURE_SCHEME "${raw}". Expected "hex" or "sha256_prefix".`,
  )
}

function optional(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {}
}

/**
 * Fail the deploy rather than the run. Rethrows the parser's own message with the
 * ENV VARIABLE names attached, so an operator reading a container log is told
 * which variable to fix rather than which admin-form field — they never opened the
 * form. Nothing here echoes a value.
 */
function assertPresetResolves(credentials: GenericHttpCredentialShape): void {
  try {
    parseGenericHttpCredentials(credentials as Record<string, unknown>)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[agent_http] The HTTP agent env preset does not resolve to a usable configuration: ${detail} (check OM_INTEGRATION_AGENT_HTTP_RESULT_PATH and OM_INTEGRATION_AGENT_HTTP_REQUEST_TEMPLATE).`,
    )
  }
}

async function hasExistingConfiguration(
  credentialsService: CredentialsService,
  integrationStateService: IntegrationStateService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, state] = await Promise.all([
    credentialsService.getRaw(AGENT_HTTP_INTEGRATION_ID, scope),
    integrationStateService.get(AGENT_HTTP_INTEGRATION_ID, scope),
  ])
  return Boolean(credentials) || Boolean(state)
}

export async function applyGenericHttpEnvPreset(params: {
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyGenericHttpPresetResult> {
  const preset = readGenericHttpEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No HTTP agent preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (
    !force
    && (await hasExistingConfiguration(params.credentialsService, params.integrationStateService, params.scope))
  ) {
    return {
      status: 'skipped',
      reason: 'HTTP agent credentials or state already exist. Use force to overwrite them.',
    }
  }

  await params.credentialsService.save(AGENT_HTTP_INTEGRATION_ID, preset.credentials, params.scope)
  await params.integrationStateService.upsert(
    AGENT_HTTP_INTEGRATION_ID,
    { isEnabled: preset.enabled },
    params.scope,
  )

  if (params.integrationLogService) {
    await params.integrationLogService
      .scoped(AGENT_HTTP_INTEGRATION_ID, params.scope)
      .info('HTTP agent integration was preconfigured from environment variables.', {
        enabled: preset.enabled,
        // Non-secret configuration only.
        signatureScheme: preset.credentials.signatureScheme ?? null,
        resultPath: preset.credentials.resultPath ?? null,
      })
  }

  return { status: 'configured', enabled: preset.enabled }
}
