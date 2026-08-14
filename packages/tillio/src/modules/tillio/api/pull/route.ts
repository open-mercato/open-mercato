import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { PHONE_CALL_RESOURCE_KIND } from '@open-mercato/shared/modules/phone_calls/types'
import { TILLIO_PROVIDER_KEY } from '../../integration'
import {
  resolvePullContext,
  TILLIO_PULL_JOB_TYPE,
  type TillioPullJobPayload,
} from '../../lib/pull-job'
import type { TillioCredentialsService } from '../../lib/operators-store'
import { blockerSection, PULL_BLOCKER_MESSAGES } from '../../lib/pull-readiness'
import { getTillioQueue, TILLIO_PULL_QUEUE } from '../../lib/queue'

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
    summary: 'Queue a Tillio phone-call pull and return its progress job id',
    responses: [
      { status: 202, description: 'Pull queued; returns { progressJobId }' },
      { status: 400, description: 'Invalid day range' },
      { status: 401, description: 'Unauthorized' },
      { status: 409, description: 'Tillio is not ready to pull (environment or operator blocker)' },
      { status: 429, description: 'A pull is already running for this scope' },
    ],
  },
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
    return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Unauthorized' }, { status: 401 })
  }

  const parsedBody = pullBodySchema.safeParse(await readJsonSafe(req))
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, code: 'invalid_payload', message: 'Invalid pull payload' }, { status: 400 })
  }
  const body = parsedBody.data

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const progressService = container.resolve('progressService') as ProgressService
  const em = container.resolve('em') as EntityManager
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }
  const progressContext = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub ?? null,
  }

  // Checked here as well as in the worker so an unconfigured provider answers immediately
  // instead of parking a job that can only fail.
  const { readiness } = await resolvePullContext(credentialsService, em, scope)
  if (readiness.blocker) {
    return NextResponse.json(
      {
        ok: false,
        code: readiness.blocker,
        section: blockerSection(readiness.blocker),
        message: PULL_BLOCKER_MESSAGES[readiness.blocker],
      },
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

  // Best-effort: this check and `createJob` are not atomic, so two near-simultaneous requests
  // can both pass. Harmless because the worker runs at concurrency 1 and ingest is idempotent.
  const active = await progressService.getActiveJobs(progressContext)
  if (active.some((job) => job.jobType === TILLIO_PULL_JOB_TYPE)) {
    return NextResponse.json(
      { ok: false, code: 'pull_already_running', section: 'operator', message: 'A Tillio pull is already running.' },
      { status: 429 },
    )
  }

  const progressJob = await progressService.createJob(
    {
      jobType: TILLIO_PULL_JOB_TYPE,
      name: 'Pull calls from Tillio',
      description: `Pulling Tillio calls from ${body.from} to ${body.to}`,
      cancellable: true,
      meta: {
        resourceKind: PHONE_CALL_RESOURCE_KIND,
        providerKey: TILLIO_PROVIDER_KEY,
        from: body.from,
        to: body.to,
      },
    },
    progressContext,
  )

  const payload: TillioPullJobPayload = {
    progressJobId: progressJob.id,
    scope: { tenantId: auth.tenantId, organizationId: auth.orgId, userId: auth.sub ?? null },
    from: body.from,
    to: body.to,
    cursor: body.cursor ?? null,
    limit: body.limit ?? null,
  }
  await getTillioQueue(TILLIO_PULL_QUEUE).enqueue(payload as unknown as Record<string, unknown>)

  await guarded.runAfterSuccess()

  return NextResponse.json({ ok: true, progressJobId: progressJob.id }, { status: 202 })
}
