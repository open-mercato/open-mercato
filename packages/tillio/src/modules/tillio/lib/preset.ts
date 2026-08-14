import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { TILLIO_INTEGRATION_ID } from '../integration'
import { environmentSchema, type TillioEnvironment } from './environment'
import { attachOperator, detachOperator, TillioOperatorLimitError } from './operators'
import { readOperatorsBlob, type TillioCredentialsService, type TillioOperatorRecord } from './operators-store'

const logger = createLogger('tillio').child({ component: 'preset' })

export const TILLIO_ENV_VARS = {
  apiUrl: 'OM_INTEGRATION_TILLIO_API_URL',
  apiKey: 'OM_INTEGRATION_TILLIO_API_KEY',
  ringostatKey: 'OM_INTEGRATION_TILLIO_RINGOSTAT_KEY',
  force: 'OM_INTEGRATION_TILLIO_FORCE_PRECONFIGURE',
  replaceOperator: 'OM_INTEGRATION_TILLIO_REPLACE_OPERATOR',
} as const

export type TillioEnvPreset =
  | { status: 'absent' }
  | { status: 'incomplete'; missing: string[] }
  | {
    status: 'ready'
    credentials: TillioEnvironment
    ringostatKey: string | null
    force: boolean
    replaceOperator: boolean
  }

export type TillioPresetOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'blocked'; reason: string }
  | {
    status: 'applied'
    credentialsAction: 'saved' | 'kept'
    health: string
    operator: 'attached' | 'kept' | 'not-requested' | 'failed'
  }

type IntegrationStateServiceLike = {
  upsert: (
    integrationId: string,
    input: { isEnabled?: boolean },
    scope: IntegrationScope,
  ) => Promise<unknown>
}

type IntegrationHealthServiceLike = {
  runHealthCheck: (integrationId: string, scope: IntegrationScope) => Promise<{ status: string; message?: string }>
}

type IntegrationLogServiceLike = {
  scoped: (
    integrationId: string,
    scope: IntegrationScope,
  ) => {
    info: (message: string, fields?: Record<string, unknown>) => Promise<unknown>
    warn: (message: string, fields?: Record<string, unknown>) => Promise<unknown>
  }
}

export type ApplyTillioEnvPresetParams = {
  credentialsService: TillioCredentialsService
  integrationStateService: IntegrationStateServiceLike
  integrationHealthService: IntegrationHealthServiceLike
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
  appUrl?: string
  integrationLogService?: IntegrationLogServiceLike
  // Supplied by the CLI, where somebody is at the terminal to answer. Tenant bootstrap passes
  // nothing, so the swap is refused unless the deployment declared it through the env var.
  confirmOperatorReplacement?: (operator: TillioOperatorRecord) => Promise<boolean>
}

function readValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

export function readTillioEnvPreset(env: NodeJS.ProcessEnv = process.env): TillioEnvPreset {
  const apiUrl = readValue(env, TILLIO_ENV_VARS.apiUrl)
  const apiKey = readValue(env, TILLIO_ENV_VARS.apiKey)
  if (!apiUrl && !apiKey) return { status: 'absent' }

  const missing: string[] = []
  if (!apiUrl) missing.push(TILLIO_ENV_VARS.apiUrl)
  if (!apiKey) missing.push(TILLIO_ENV_VARS.apiKey)
  // Reported rather than thrown: a half-set preset must not take tenant bootstrap down with it.
  if (missing.length) return { status: 'incomplete', missing }

  return {
    status: 'ready',
    credentials: environmentSchema.parse({ apiUrl, apiKey }),
    ringostatKey: readValue(env, TILLIO_ENV_VARS.ringostatKey) ?? null,
    force: parseBooleanToken(readValue(env, TILLIO_ENV_VARS.force)) ?? false,
    replaceOperator: parseBooleanToken(readValue(env, TILLIO_ENV_VARS.replaceOperator)) ?? false,
  }
}

function pointsAtAnotherEnvironment(
  stored: Record<string, unknown> | null,
  next: TillioEnvironment,
): boolean {
  const parsed = environmentSchema.safeParse(stored ?? {})
  if (!parsed.success) return false
  return parsed.data.apiUrl !== next.apiUrl || parsed.data.apiKey !== next.apiKey
}

async function attachOperatorFromPreset(params: {
  credentialsService: TillioCredentialsService
  scope: IntegrationScope
  appUrl: string
  ringostatKey: string
}): Promise<'attached' | 'kept' | 'failed'> {
  if (!params.appUrl.trim()) {
    logger.warn('cannot attach the operator without APP_URL')
    return 'failed'
  }

  try {
    await attachOperator(
      { credentialsService: params.credentialsService, scope: params.scope, appUrl: params.appUrl },
      { plugin: 'Ringostat', config: { key: params.ringostatKey } },
    )
    return 'attached'
  } catch (err) {
    // The slot is taken, which is the expected outcome of a rerun.
    if (err instanceof TillioOperatorLimitError) return 'kept'
    logger.warn('failed to attach the operator from the env preset', { err })
    return 'failed'
  }
}

// Every step goes through the service the admin UI uses for the same action, so an env-driven
// bootstrap and a hand-configured one converge on identical stored state, and anything the preset
// wrote stays editable in the UI afterwards.
export async function applyTillioEnvPreset(params: ApplyTillioEnvPresetParams): Promise<TillioPresetOutcome> {
  const preset = readTillioEnvPreset(params.env)

  if (preset.status === 'absent') {
    return { status: 'skipped', reason: 'No Tillio preset environment variables were provided.' }
  }
  if (preset.status === 'incomplete') {
    const reason = `Incomplete Tillio env preset; missing ${preset.missing.join(', ')}.`
    await params.integrationLogService?.scoped(TILLIO_INTEGRATION_ID, params.scope).warn(reason).catch(() => undefined)
    return { status: 'skipped', reason }
  }

  const force = params.force ?? preset.force
  const existing = await params.credentialsService.getRaw(TILLIO_INTEGRATION_ID, params.scope)
  // Overwriting silently would undo a rotation somebody performed in the UI.
  const credentialsAction = existing && !force ? 'kept' : 'saved'

  if (credentialsAction === 'saved' && pointsAtAnotherEnvironment(existing, preset.credentials)) {
    const attached = (await readOperatorsBlob(params.credentialsService, params.scope)).operators[0] ?? null
    if (attached) {
      if (!preset.ringostatKey) {
        return {
          status: 'blocked',
          reason: `The attached operator belongs to the current environment. Set ${TILLIO_ENV_VARS.ringostatKey} so it can be reattached to the new one.`,
        }
      }

      const approved = preset.replaceOperator
        || (params.confirmOperatorReplacement ? await params.confirmOperatorReplacement(attached) : false)
      if (!approved) {
        return {
          status: 'blocked',
          reason: `Switching environments would strand the attached operator. Confirm the replacement or set ${TILLIO_ENV_VARS.replaceOperator}.`,
        }
      }

      // Revoked while the credentials that minted its token are still stored; afterwards the new
      // environment would reject the token and the record could only be dropped by force.
      await detachOperator({ credentialsService: params.credentialsService, scope: params.scope }, attached.id)
    }
  }

  if (credentialsAction === 'saved') {
    await params.credentialsService.save(TILLIO_INTEGRATION_ID, { ...preset.credentials }, params.scope)
  }

  await params.integrationStateService.upsert(TILLIO_INTEGRATION_ID, { isEnabled: true }, params.scope)

  // Also mints the tenant identity the operator token is bound to, so it has to run before attaching.
  const health = await params.integrationHealthService.runHealthCheck(TILLIO_INTEGRATION_ID, params.scope)

  let operator: 'attached' | 'kept' | 'not-requested' | 'failed' = 'not-requested'
  if (preset.ringostatKey) {
    operator = health.status === 'healthy'
      ? await attachOperatorFromPreset({
        credentialsService: params.credentialsService,
        scope: params.scope,
        appUrl: params.appUrl ?? process.env.APP_URL ?? '',
        ringostatKey: preset.ringostatKey,
      })
      : 'failed'
  }

  await params.integrationLogService
    ?.scoped(TILLIO_INTEGRATION_ID, params.scope)
    .info('Tillio was preconfigured from environment variables.', {
      credentialsAction,
      health: health.status,
      operator,
    })
    .catch(() => undefined)

  return { status: 'applied', credentialsAction, health: health.status, operator }
}
