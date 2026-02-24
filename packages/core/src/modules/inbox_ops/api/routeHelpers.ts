import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { EventBus } from '@open-mercato/events/types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal, InboxProposalAction } from '../data/entities'
import type { CrossModuleEntities } from '../lib/executionEngine'
import { resolveOptionalEventBus } from '../lib/eventBus'

export interface RequestContext {
  auth: AuthContext
  userId: string
  tenantId: string
  organizationId: string
  scope: { tenantId: string; organizationId: string }
  em: EntityManager
  container: AwilixContainer
  eventBus: EventBus | null
}

export interface ExecutionContextInput {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  eventBus: EventBus | null
  container: AwilixContainer
  auth: AuthContext
  entities?: CrossModuleEntities
}

export async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId || !auth?.orgId) {
    throw new UnauthorizedError()
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  return {
    auth,
    userId: auth.sub,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
    em,
    container,
    eventBus: resolveOptionalEventBus(container),
  }
}

export function extractPathSegment(url: URL, afterSegment: string): string | null {
  const segments = url.pathname.split('/')
  const index = segments.indexOf(afterSegment)
  return index >= 0 ? segments[index + 1] || null : null
}

export async function resolveActionAndProposal(
  url: URL,
  ctx: RequestContext,
): Promise<{ action: InboxProposalAction; proposal: InboxProposal } | NextResponse> {
  const proposalId = extractPathSegment(url, 'proposals')
  const actionId = extractPathSegment(url, 'actions')

  if (!proposalId || !actionId) {
    return NextResponse.json({ error: 'Missing IDs' }, { status: 400 })
  }

  const action = await findOneWithDecryption(
    ctx.em,
    InboxProposalAction,
    {
      id: actionId,
      proposalId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    },
    undefined,
    ctx.scope,
  )

  if (!action) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  }

  const proposal = await findOneWithDecryption(
    ctx.em,
    InboxProposal,
    {
      id: proposalId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      isActive: true,
      deletedAt: null,
    },
    undefined,
    ctx.scope,
  )
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal has been superseded by a newer extraction' }, { status: 409 })
  }

  return { action, proposal }
}

export async function resolveProposal(
  url: URL,
  ctx: RequestContext,
): Promise<InboxProposal | NextResponse> {
  const proposalId = extractPathSegment(url, 'proposals')

  if (!proposalId) {
    return NextResponse.json({ error: 'Missing proposal ID' }, { status: 400 })
  }

  const proposal = await findOneWithDecryption(
    ctx.em,
    InboxProposal,
    {
      id: proposalId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      isActive: true,
      deletedAt: null,
    },
    undefined,
    ctx.scope,
  )

  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  return proposal
}

export function toExecutionContext(ctx: RequestContext, entities?: CrossModuleEntities): ExecutionContextInput {
  return {
    em: ctx.em,
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    eventBus: ctx.eventBus,
    container: ctx.container,
    auth: ctx.auth,
    entities,
  }
}

export function handleRouteError(err: unknown, label: string): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.error(`[inbox_ops:${label}] Error:`, err)
  return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 })
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse
}

export function resolveCrossModuleEntities(container: AwilixContainer): CrossModuleEntities {
  const entities: Partial<CrossModuleEntities> = {}
  try { entities.CustomerEntity = container.resolve('CustomerEntity') } catch { /* module not available */ }
  try { entities.SalesOrder = container.resolve('SalesOrder') } catch { /* module not available */ }
  try { entities.SalesShipment = container.resolve('SalesShipment') } catch { /* module not available */ }
  try { entities.SalesChannel = container.resolve('SalesChannel') } catch { /* module not available */ }
  try { entities.Dictionary = container.resolve('Dictionary') } catch { /* module not available */ }
  try { entities.DictionaryEntry = container.resolve('DictionaryEntry') } catch { /* module not available */ }
  return entities as CrossModuleEntities
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
  }
}
