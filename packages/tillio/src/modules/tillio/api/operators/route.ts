import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import {
  computeEnvFingerprint,
  readOperatorsBlob,
  type TillioCredentialsService,
} from '../../lib/operators-store'
import { createTillioLock, tillioOperatorLockKey } from '../../lib/locking'
import { evaluateEnvironmentReadiness, type EnvironmentBlocker } from '../../lib/pull-readiness'
import {
  TillioApiError,
} from '../../lib/errors'
import {
  attachOperator,
  classifyTillioError,
  readTillioIntegrationState,
  resolveEnvironment,
  TILLIO_OPERATOR_RESOURCE_KIND,
  TillioEnvironmentNotReadyError,
  TillioOperatorLimitError,
} from '../../lib/operators'

const SUPPORTED_PLUGINS = ['Ringostat'] as const

// Same blockers as the pull reports, worded for the action the caller was attempting.
const ATTACH_BLOCKER_MESSAGES: Record<EnvironmentBlocker, string> = {
  integration_disabled: 'The Tillio integration is disabled. Enable it before attaching an operator.',
  environment_not_ready: 'Run the Tillio environment health check before attaching an operator.',
}

const attachBodySchema = z.object({
  plugin: z.literal('Ringostat'),
  config: z.object({ key: z.string().trim().min(1) }),
  label: z.string().trim().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tillio.manage', 'integrations.manage'] },
  POST: { requireAuth: true, requireFeatures: ['tillio.manage', 'integrations.manage'] },
}

export const openApi = {
  tags: ['Tillio'],
  summary: 'List and attach Tillio operators',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const em = container.resolve('em') as EntityManager
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const environment = await resolveEnvironment(credentialsService, scope)
  const integrationState = await readTillioIntegrationState(em, scope)
  const { ready: environmentReady, blocker: environmentBlocker } = evaluateEnvironmentReadiness({
    environment,
    integrationEnabled: integrationState.enabled,
    environmentHealthy: integrationState.healthy,
  })
  const blob = await readOperatorsBlob(credentialsService, scope)
  const currentFingerprint = environment ? computeEnvFingerprint(environment) : null

  const operators = blob.operators.map((operator) => ({
    id: operator.id,
    plugin: operator.plugin,
    tenantDomain: operator.tenantDomain,
    stale: currentFingerprint ? operator.envFingerprint !== currentFingerprint : true,
  }))

  return NextResponse.json({
    ok: true,
    environmentReady,
    environmentBlocker,
    tenantSystemId: environment?.tenantSystemId ?? null,
    supportedPlugins: SUPPORTED_PLUGINS,
    operators,
    defaultOperatorId: blob.defaultOperatorId,
    envDrift: operators.some((operator) => operator.stale),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Unauthorized' }, { status: 401 })
  }

  const parsedBody = attachBodySchema.safeParse(await readJsonSafe(req))
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, code: 'invalid_payload', message: 'Invalid operator payload' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const em = container.resolve('em') as EntityManager
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const environment = await resolveEnvironment(credentialsService, scope)
  const integrationState = await readTillioIntegrationState(em, scope)
  // Provisioning an operator registers a config on Tillio's side, so the environment is checked
  // here rather than left to the pull to discover. The decision is the shared one; only the
  // wording is specific to attaching.
  const { blocker } = evaluateEnvironmentReadiness({
    environment,
    integrationEnabled: integrationState.enabled,
    environmentHealthy: integrationState.healthy,
  })
  if (blocker) {
    return NextResponse.json(
      { ok: false, code: blocker, section: 'environment', message: ATTACH_BLOCKER_MESSAGES[blocker] },
      { status: 409 },
    )
  }

  const appUrl = process.env.APP_URL ?? ''
  if (!appUrl.trim()) {
    return NextResponse.json(
      { ok: false, code: 'app_url_missing', section: 'environment', message: 'APP_URL is not configured; it is required to derive the operator webhook domain.' },
      { status: 500 },
    )
  }

  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: auth.tenantId, organizationId: auth.orgId },
    input: {
      resourceKind: TILLIO_OPERATOR_RESOURCE_KIND,
      operation: 'create',
      // The operator key is a credential, so it is described to guards, never handed to them.
      mutationPayload: { plugin: parsedBody.data.plugin, label: parsedBody.data.label ?? null },
    },
  })
  if (!guarded.ok) return guarded.response

  const guardedLabel = typeof guarded.modifiedPayload?.label === 'string'
    ? guarded.modifiedPayload.label
    : parsedBody.data.label

  try {
    const operator = await attachOperator(
      { credentialsService, scope, appUrl, withLock: createTillioLock(em, tillioOperatorLockKey(scope)) },
      { plugin: parsedBody.data.plugin, config: parsedBody.data.config, label: guardedLabel },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({
      ok: true,
      operator: { id: operator.id, plugin: operator.plugin, tenantDomain: operator.tenantDomain },
    })
  } catch (err) {
    if (err instanceof TillioOperatorLimitError) {
      return NextResponse.json({ ok: false, code: 'operator_limit', section: 'operator', message: err.message }, { status: 409 })
    }
    if (err instanceof TillioEnvironmentNotReadyError) {
      return NextResponse.json({ ok: false, code: 'environment_not_ready', section: 'environment', message: err.message }, { status: 409 })
    }
    if (err instanceof TillioApiError) {
      const section = classifyTillioError(err)
      return NextResponse.json(
        { ok: false, code: 'provider_error', section, message: err.message },
        { status: section === 'environment' ? 502 : 422 },
      )
    }
    return NextResponse.json({ ok: false, code: 'attach_failed', section: 'operator', message: 'Failed to attach the operator.' }, { status: 500 })
  }
}
