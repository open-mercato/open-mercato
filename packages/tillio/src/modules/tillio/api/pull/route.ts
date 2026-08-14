import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { NormalizedPhoneCall } from '@open-mercato/shared/modules/phone_calls/types'
import {
  PHONE_CALL_RESOURCE_KIND,
  PHONE_CALLS_CALL_INGEST_COMMAND_ID,
  type IngestPhoneCallResult,
} from '@open-mercato/core/modules/phone_calls/commands/calls'
import { emitPhoneCallsEvent } from '@open-mercato/core/modules/phone_calls/events'
import { TILLIO_INTEGRATION_ID } from '../../lib/environment'
import { TillioApiError } from '../../lib/errors'
import { tillioAdapter } from '../../lib/adapter'
import { classifyTillioError, isTillioEnvironmentHealthy, resolveEnvironment, type TillioResolvedEnvironment } from '../../lib/operators'
import {
  readOperatorsBlob,
  type TillioCredentialsService,
  type TillioOperatorRecord,
} from '../../lib/operators-store'
import {
  blockerSection,
  evaluatePullReadiness,
  PULL_BLOCKER_MESSAGES,
  type PullReadiness,
} from '../../lib/pull-readiness'
import { zonedDayEnd, zonedDayStart } from '../../lib/tz'

const TILLIO_PROVIDER_KEY = 'tillio'

const daySchema = z.iso.date()

export const pullBodySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  })
  .refine((body) => body.from <= body.to, { message: 'The start day must not be after the end day.' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['phone_calls.manage', 'integrations.manage'] },
  POST: { requireAuth: true, requireFeatures: ['phone_calls.manage', 'integrations.manage'] },
}

export const openApi = {
  GET: {
    tags: ['Tillio'],
    summary: 'Report whether Tillio is ready to pull phone calls',
  },
  POST: {
    tags: ['Tillio'],
    summary: 'Pull phone calls from Tillio into the phone_calls hub',
  },
}

type PullContext = {
  readiness: PullReadiness
  environment: TillioResolvedEnvironment | null
  operator: TillioOperatorRecord | null
}

async function resolvePullContext(
  credentialsService: TillioCredentialsService,
  em: EntityManager,
  scope: IntegrationScope,
): Promise<PullContext> {
  const environment = await resolveEnvironment(credentialsService, scope)
  const environmentHealthy = environment ? await isTillioEnvironmentHealthy(em, scope) : false
  const blob = await readOperatorsBlob(credentialsService, scope)
  const operator =
    blob.operators.find((entry) => entry.id === blob.defaultOperatorId) ?? blob.operators[0] ?? null

  return {
    readiness: evaluatePullReadiness({ environment, environmentHealthy, operator }),
    environment,
    operator,
  }
}

function buildIngestInput(call: NormalizedPhoneCall, scope: IntegrationScope): Record<string, unknown> {
  return {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    providerKey: TILLIO_PROVIDER_KEY,
    integrationId: TILLIO_INTEGRATION_ID,
    externalCallId: call.externalCallId,
    externalConversationId: call.externalConversationId ?? null,
    direction: call.direction,
    status: call.status,
    participants: call.participants,
    recording: call.recording ?? null,
    startedAt: call.startedAt ?? null,
    answeredAt: call.answeredAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSeconds: call.durationSeconds ?? null,
    providerFacts: call.providerFacts,
    rawPayload: call.rawPayload,
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const em = container.resolve('em') as EntityManager
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const { readiness, operator } = await resolvePullContext(credentialsService, em, scope)

  return NextResponse.json({
    ok: true,
    ...readiness,
    operatorId: operator?.id ?? null,
    plugin: operator?.plugin ?? null,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const parsedBody = pullBodySchema.safeParse(await readJsonSafe(req))
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, message: 'Invalid pull payload' }, { status: 400 })
  }
  const body = parsedBody.data

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const commandBus = container.resolve('commandBus') as CommandBus
  const em = container.resolve('em') as EntityManager
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const { readiness, environment, operator } = await resolvePullContext(credentialsService, em, scope)
  if (readiness.blocker || !environment || !operator) {
    const blocker = readiness.blocker ?? 'environment_not_ready'
    return NextResponse.json(
      { ok: false, code: blocker, section: blockerSection(blocker), message: PULL_BLOCKER_MESSAGES[blocker] },
      { status: 409 },
    )
  }

  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: {
      userId: auth.sub,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    },
    input: {
      resourceKind: PHONE_CALL_RESOURCE_KIND,
      operation: 'custom',
      mutationPayload: { providerKey: TILLIO_PROVIDER_KEY, from: body.from, to: body.to },
    },
  })
  if (!guarded.ok) return guarded.response

  let batch
  try {
    batch = await tillioAdapter.fetchCalls({
      credentials: {
        apiUrl: environment.apiUrl,
        apiKey: environment.apiKey,
        tenantSystemId: environment.tenantSystemId,
        operator: {
          id: operator.id,
          plugin: operator.plugin,
          token: operator.token,
          tenantDomain: operator.tenantDomain,
        },
      },
      scope,
      integrationId: TILLIO_INTEGRATION_ID,
      from: zonedDayStart(body.from),
      to: zonedDayEnd(body.to),
      cursor: body.cursor ?? null,
      limit: body.limit ?? null,
    })
  } catch (err) {
    if (err instanceof TillioApiError) {
      const section = classifyTillioError(err)
      return NextResponse.json(
        { ok: false, section, message: err.message },
        { status: section === 'environment' ? 502 : 422 },
      )
    }
    return NextResponse.json({ ok: false, section: 'operator', message: 'Failed to fetch calls from Tillio.' }, { status: 500 })
  }

  const commandContext: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: req,
  }

  let created = 0
  let updated = 0
  let failed = 0
  // One ingest command (hence one transaction) per call, run sequentially: this keeps
  // failures isolated so a single bad record only bumps `failed` and the rest of the
  // batch still lands. For a manual, low-frequency pull (<=500 per batch) that isolation
  // is worth more than the throughput a single bulk transaction would buy.
  for (const call of batch.calls) {
    try {
      const executed = await commandBus.execute<Record<string, unknown>, IngestPhoneCallResult>(
        PHONE_CALLS_CALL_INGEST_COMMAND_ID,
        { input: buildIngestInput(call, scope), ctx: commandContext },
      )
      if (executed.result.created) created += 1
      else updated += 1
    } catch {
      failed += 1
      // Keep a forensic trail for the swallowed failure (event carries no PII).
      await emitPhoneCallsEvent('phone_calls.call.ingest_failed', {
        providerKey: TILLIO_PROVIDER_KEY,
        externalCallId: call.externalCallId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      }).catch(() => undefined)
    }
  }

  await guarded.runAfterSuccess()

  return NextResponse.json({
    ok: true,
    fetched: batch.calls.length,
    created,
    updated,
    failed,
    nextCursor: batch.nextCursor ?? null,
    hasMore: Boolean(batch.nextCursor),
  })
}
