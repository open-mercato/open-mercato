import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaimEvent } from '../../data/entities'
import { commentClaimInputSchema, type CommentClaimInput } from '../../data/validators'
import { requireScopedClaim, WARRANTY_CLAIM_RESOURCE_KIND, type WarrantyClaimScope } from '../../commands/shared'

const eventListQuerySchema = z.object({
  claimId: z.string().uuid(),
})

type EventRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  scope: WarrantyClaimScope
  translate: (key: string, fallback?: string) => string
  em: EntityManager
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = toRecord(value)
  return typeof record.id === 'string' ? record.id : null
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function serializeEvent(event: WarrantyClaimEvent) {
  return {
    id: event.id,
    claimId: relationId(event.claim),
    kind: event.kind,
    visibility: event.visibility,
    body: event.body ?? null,
    payload: event.payload ?? null,
    actorUserId: event.actorUserId ?? null,
    actorCustomerId: event.actorCustomerId ?? null,
    createdAt: toIso(event.createdAt),
  }
}

async function resolveEventContext(req: Request): Promise<EventRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  const em = container.resolve('em') as EntityManager
  return {
    ctx: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    scope: { tenantId: auth.tenantId, organizationId },
    translate,
    em,
  }
}

async function runCommentGuard(
  req: Request,
  context: EventRouteContext,
  input: CommentClaimInput,
): Promise<RouteMutationGuardResult> {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: context.translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: {
      userId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: input.claimId,
      operation: 'custom',
      mutationPayload: { ...input },
    },
  })
}

export async function GET(req: Request) {
  try {
    const context = await resolveEventContext(req)
    const url = new URL(req.url)
    const query = eventListQuerySchema.parse({ claimId: url.searchParams.get('claimId') ?? undefined })
    const claim = await requireScopedClaim(context.em, query.claimId, context.scope)
    const events = await findWithDecryption(
      context.em,
      WarrantyClaimEvent,
      { claim: claim.id, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      { orderBy: { createdAt: 'ASC' } },
      context.scope,
    )
    return NextResponse.json({ items: events.map(serializeEvent) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.events.get failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.notFound', 'Warranty claim not found.') }, { status: 404 })
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveEventContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const parsed = commentClaimInputSchema.parse(payload)
    const input: CommentClaimInput = { ...parsed, actorCustomerId: undefined }
    const guarded = await runCommentGuard(req, context, input)
    if (!guarded.ok) {
      return guarded.response
    }
    const commandInput = guarded.modifiedPayload
      ? { ...commentClaimInputSchema.parse(guarded.modifiedPayload), actorCustomerId: undefined }
      : input

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CommentClaimInput, { claimId: string }>(
      'warranty_claims.claim.comment',
      { input: commandInput, ctx: context.ctx },
    )

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, claimId: result?.claimId ?? commandInput.claimId })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.events.post failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

const eventSchema = z.object({
  id: z.string().uuid(),
  claimId: z.string().uuid().nullable(),
  kind: z.string(),
  visibility: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  actorUserId: z.string().uuid().nullable(),
  actorCustomerId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Warranty claim timeline events',
  methods: {
    GET: {
      summary: 'List timeline events for a claim',
      query: eventListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Timeline events',
          schema: z.object({ items: z.array(eventSchema) }),
        },
      ],
    },
    POST: {
      summary: 'Append a staff comment to a claim timeline',
      requestBody: { contentType: 'application/json', schema: commentClaimInputSchema },
      responses: [
        {
          status: 200,
          description: 'Comment appended',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid() }),
        },
      ],
    },
  },
}
