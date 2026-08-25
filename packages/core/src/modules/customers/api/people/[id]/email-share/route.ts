import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { CustomerEntity } from '../../../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { EmailConversationShareSetCommandInput } from '../../../../data/validators'
import {
  canShareConversation,
  listSharesForPerson,
} from '../../../../lib/conversationShares'

export const metadata = {
  path: '/customers/people/[id]/email-share',
  GET: {
    requireAuth: true,
    requireFeatures: ['customers.people.view'],
  },
  PUT: {
    requireAuth: true,
    requireFeatures: ['customers.email.share_conversation'],
  },
}

const bodySchema = z.object({ shared: z.boolean() }).strict()

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

type ResolvedPerson = {
  person: { id: string; organizationId?: string | null; tenantId?: string | null }
  organizationId: string | null
  tenantId: string
  viewerUserId: string | null
  em: EntityManager
  container: Awaited<ReturnType<typeof createRequestContainer>>
}

/**
 * Load the Person in the caller's scope, or return a 404 response.
 *
 * Loading by tenant + id (rather than a hand-rolled selected org) keeps this
 * working under the "All organizations" scope, then fails closed on the record's
 * own organization — the same shape the sibling person routes use.
 */
async function resolvePerson(
  req: Request,
  personId: string,
): Promise<ResolvedPerson | Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = (container.resolve('em') as EntityManager).fork()

  const person = (await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: personId, kind: 'person', tenantId: auth.tenantId, deletedAt: null } as never,
    undefined,
    {
      tenantId: auth.tenantId as string,
      organizationId: scope?.selectedId ?? (auth as { orgId?: string | null }).orgId ?? null,
    },
  )) as { id: string; organizationId?: string | null; tenantId?: string | null } | null

  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const organizationId = person.organizationId ?? null
  if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId })) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  return {
    person,
    organizationId,
    tenantId: auth.tenantId as string,
    viewerUserId: auth.isApiKey ? null : auth.sub ?? null,
    em,
    container,
  }
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id: personId } = await context.params
  if (!z.string().uuid().safeParse(personId).success) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
  }

  const resolved = await resolvePerson(req, personId)
  if (resolved instanceof Response) return resolved
  const { em, tenantId, organizationId, viewerUserId } = resolved
  const scope = { tenantId, organizationId }

  const [shares, canShare] = await Promise.all([
    listSharesForPerson(em, scope, personId),
    canShareConversation(em, scope, viewerUserId, personId),
  ])

  const ownShare = viewerUserId
    ? shares.find((row) => row.ownerUserId === viewerUserId) ?? null
    : null

  // Shares granted BY OTHER owners — what the UI renders as "Shared by Ann".
  const othersShares = shares.filter((row) => row.ownerUserId !== viewerUserId)
  const ownerNames = await resolveUserNames(
    em,
    tenantId,
    organizationId,
    othersShares.map((row) => row.ownerUserId),
  )

  return NextResponse.json({
    sharedByMe: !!ownShare,
    canShare,
    updatedAt: ownShare?.updatedAt ? ownShare.updatedAt.toISOString() : null,
    sharedBy: othersShares.map((row) => ({
      userId: row.ownerUserId,
      userName: ownerNames.get(row.ownerUserId) ?? null,
      sharedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    })),
  })
}

export async function PUT(req: Request, context: RouteContext): Promise<Response> {
  const { id: personId } = await context.params
  if (!z.string().uuid().safeParse(personId).success) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await readJsonSafe(req, null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const resolved = await resolvePerson(req, personId)
  if (resolved instanceof Response) return resolved
  const { em, tenantId, organizationId, viewerUserId, container } = resolved

  // An API-key principal owns no mailbox, so it has nothing to share. 404 rather
  // than 403, matching the per-message toggle's row-existence masking.
  if (!viewerUserId) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }
  if (!organizationId) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId,
    organizationId,
    userId: viewerUserId,
    resourceKind: 'customers.email_conversation_share',
    resourceId: personId,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  // Version token for optimistic locking, taken only from the request. An absent
  // header means "no expectation" and is strictly additive — the shared assertion
  // helper skips the check rather than blocking clients that never send it.
  const expectedUpdatedAt = readOptimisticLockExpected(req)

  const commandBus = container.resolve('commandBus') as CommandBus
  let result: { shareId: string | null; changed: boolean }
  try {
    result = await commandBus.execute<
      EmailConversationShareSetCommandInput,
      { shareId: string | null; changed: boolean }
    >('customers.email_conversation_shares.set', {
      input: {
        tenantId,
        organizationId,
        personEntityId: personId,
        shared: body.shared,
        expectedUpdatedAt,
      },
      ctx: {
        container,
        auth: (await getAuthFromRequest(req)) as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    })
  } catch (err) {
    // Surfaces the 409 conflict body and the 400 "nothing to share" case with
    // their intended status instead of a generic 500.
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId,
      organizationId,
      userId: viewerUserId,
      resourceKind: 'customers.email_conversation_share',
      resourceId: personId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  // The person-detail cache is tagged on customers resources only, and this write
  // lands in a different table, so the interaction collection tags are invalidated
  // explicitly or a teammate would keep seeing the pre-share view until TTL.
  await invalidatePersonInteractionCache(container, tenantId, organizationId)

  return NextResponse.json({ ok: true, changed: result.changed, shared: body.shared })
}

async function resolveUserNames(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id)))
  if (unique.length === 0) return names
  try {
    const users = (await findWithDecryption(
      em,
      User,
      { id: { $in: unique } } as never,
      undefined,
      { tenantId, organizationId },
    )) as Array<{ id: string; name?: string | null; email?: string | null }>
    for (const user of Array.isArray(users) ? users : []) {
      const label = user.name?.trim() || user.email?.trim() || null
      if (label) names.set(user.id, label)
    }
  } catch {
    /* best effort — the badge falls back to a generic label without a name */
  }
  return names
}

async function invalidatePersonInteractionCache(
  container: { resolve: (name: string) => unknown },
  tenantId: string,
  organizationId: string | null,
): Promise<void> {
  try {
    const cache = container.resolve('cache') as
      | { invalidateTags?: (tags: string[]) => Promise<void> }
      | undefined
    if (!cache?.invalidateTags) return
    await cache.invalidateTags([
      `customers.interaction:collection:${tenantId}:${organizationId ?? 'null'}`,
      `customers.person:collection:${tenantId}:${organizationId ?? 'null'}`,
    ])
  } catch {
    /* best effort — a stale cached page is a TTL-bounded annoyance, not a leak */
  }
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    GET: {
      summary: 'Read the conversation-share state for a Person',
      tags: ['Customers', 'Email'],
      responses: [
        { status: 200, description: 'Share state for the calling user' },
        { status: 400, description: 'Invalid person id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Person not found or not visible to caller' },
      ],
    },
    PUT: {
      summary: 'Share or un-share your own email conversation with a Person',
      tags: ['Customers', 'Email'],
      responses: [
        { status: 200, description: 'Share state updated' },
        { status: 400, description: 'Invalid id, or no private conversation to share' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Person not found or not visible to caller' },
        { status: 409, description: 'Optimistic lock conflict' },
        { status: 422, description: 'Invalid body' },
      ],
    },
  },
}
