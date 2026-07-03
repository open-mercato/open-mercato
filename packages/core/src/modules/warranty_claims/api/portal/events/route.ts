import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { WarrantyClaim, WarrantyClaimEvent } from '../../../data/entities'
import type { CommentClaimInput } from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const eventQuerySchema = z.object({
  claimId: z.string().uuid(),
})

const portalCommentSchema = z
  .object({
    claimId: z.string().uuid(),
    body: z.string().trim().min(1).max(8000),
  })
  .strict()

type PortalContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
  commandCtx: CommandRuntimeContext
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = toRecord(value)
  return typeof record.id === 'string' ? record.id : null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function serializeEvent(event: WarrantyClaimEvent) {
  return {
    id: event.id,
    claimId: relationId(event.claim),
    kind: event.kind,
    visibility: event.visibility,
    body: event.body ?? null,
    payload: event.payload ?? null,
    actorCustomerId: event.actorCustomerId ?? null,
    createdAt: toIso(event.createdAt),
  }
}

async function resolvePortalContext(req: Request): Promise<PortalContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'Customer account is not linked to a customer record' }, { status: 403 })
  }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandAuth: NonNullable<AuthContext> = {
    sub: auth.sub,
    sid: auth.sid,
    tenantId: auth.tenantId,
    orgId: auth.orgId,
    email: auth.email,
    customerEntityId: auth.customerEntityId ?? null,
    personEntityId: auth.personEntityId ?? null,
  }
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em,
    commandCtx: {
      container,
      auth: commandAuth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      request: req,
    },
  }
}

async function loadOwnedClaim(context: PortalContext, claimId: string): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    context.em,
    WarrantyClaim,
    {
      id: claimId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
      deletedAt: null,
    },
    {},
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

export async function GET(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const url = new URL(req.url)
  const parsed = eventQuerySchema.safeParse({ claimId: url.searchParams.get('claimId') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid input' }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const events = await findWithDecryption(
    context.em,
    WarrantyClaimEvent,
    { claim: claim.id, visibility: 'customer', tenantId: context.tenantId, organizationId: context.organizationId },
    { orderBy: { createdAt: 'ASC' } },
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
  return NextResponse.json({ items: events.map(serializeEvent) })
}

export async function POST(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = portalCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }

  const commandBus = context.commandCtx.container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute<CommentClaimInput, { claimId: string }>(
      'warranty_claims.claim.comment',
      {
        input: {
          claimId: claim.id,
          body: parsed.data.body,
          visibility: 'customer',
          actorCustomerId: context.customerId,
        },
        ctx: context.commandCtx,
      },
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  return NextResponse.json({ ok: true, claimId: claim.id })
}

const eventSchema = z.object({
  id: z.string().uuid(),
  claimId: z.string().uuid().nullable(),
  kind: z.string(),
  visibility: z.literal('customer'),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  actorCustomerId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim timeline',
  methods: {
    GET: {
      summary: 'List customer-visible timeline events for an owned claim',
      query: eventQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Customer-visible timeline events',
          schema: z.object({ items: z.array(eventSchema) }),
        },
      ],
    },
    POST: {
      summary: 'Append a customer-visible customer comment',
      requestBody: { contentType: 'application/json', schema: portalCommentSchema },
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
