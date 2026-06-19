import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerInteraction } from '../../../../data/entities'
import type { InteractionUpdateInput } from '../../../../data/validators'
import { resolveAuthActorId } from '../../../../lib/interactionRequestContext'
import { emitCustomersEvent } from '../../../../events'

export const metadata = {
  path: '/customers/interactions/[id]/visibility',
  PATCH: {
    requireAuth: true,
    requireFeatures: ['customers.email.compose'],
  },
}

const bodySchema = z.object({ visibility: z.enum(['private', 'shared']) }).strict()

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function PATCH(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid interaction id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }
  const userId = resolveAuthActorId(auth)

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId,
    userId,
    resourceKind: 'customers.interaction',
    resourceId: id,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const interaction = (await findOneWithDecryption(
    em,
    CustomerInteraction,
    {
      id,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
      interactionType: 'email',
    } as any,
    undefined,
    dscope,
  )) as { id: string; authorUserId?: string | null; visibility?: string | null } | null

  if (!interaction) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  // Personal mailbox privacy (v1: strict owner-only): ONLY the author may flip
  // their own email's visibility — no admin bypass. Return 404 (not 403) for
  // everyone else so we don't leak the row's existence — this also covers
  // non-authors who cannot see a private email in the first place.
  const isAuthor = !!interaction.authorUserId && interaction.authorUserId === auth.sub
  if (!isAuthor) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  // No-op: visibility is already at the requested value.
  if (interaction.visibility === body.visibility) {
    return NextResponse.json({ ok: true, changed: false })
  }

  const previousVisibility = (interaction.visibility ?? 'private') as 'private' | 'shared'

  // Route the write through the interactions update command so the change runs
  // the full mutation pipeline — query-index refresh, audit log and undo —
  // instead of a raw em.flush() that would leave the indexed `entity_indexes`
  // doc stale. Authorization (author-only, v1) was already enforced above; the
  // command only owns persistence and side effects.
  const commandBus = container.resolve('commandBus') as CommandBus
  await commandBus.execute<InteractionUpdateInput, { interactionId: string }>(
    'customers.interactions.update',
    {
      input: { id, visibility: body.visibility },
      ctx: {
        container,
        auth: auth as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    },
  )

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId,
      resourceKind: 'customers.interaction',
      resourceId: id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  // Emit audit event best-effort — failure must NOT roll back the DB flush.
  try {
    await emitCustomersEvent('customers.email.visibility_changed', {
      interactionId: interaction.id,
      previousVisibility,
      nextVisibility: body.visibility,
      authorUserId: interaction.authorUserId ?? null,
      actorUserId: auth.sub,
      // v1: strict owner-only — only the author reaches this point, so a
      // visibility change is never an admin bypass.
      adminBypass: false,
      tenantId: auth.tenantId,
      organizationId,
    })
  } catch {
    /* swallow — audit emission must not block the response */
  }

  return NextResponse.json({ ok: true, changed: true })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    PATCH: {
      summary: 'Flip an email interaction visibility (private ↔ shared)',
      tags: ['Customers', 'Email'],
      responses: [
        { status: 200, description: 'Updated' },
        { status: 400, description: 'Invalid id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Email not found or not visible to caller' },
        { status: 422, description: 'Invalid body' },
      ],
    },
  },
}

export default PATCH
