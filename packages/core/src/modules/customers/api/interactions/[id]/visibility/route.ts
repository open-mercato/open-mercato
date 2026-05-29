import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerInteraction } from '../../../../data/entities'
import { callerHasEmailViewPrivate } from '../../../../lib/visibilityFilter'
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

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    input: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

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
    body = bodySchema.parse(await req.json().catch(() => null))
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

  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (rbac?.getGrantedFeatures) {
      const features = await rbac.getGrantedFeatures(auth.sub as string, {
        tenantId: auth.tenantId as string,
        organizationId,
      })
      userFeatures = Array.isArray(features) ? features : []
    }
  } catch {
    userFeatures = []
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

  const isAuthor = !!interaction.authorUserId && interaction.authorUserId === auth.sub
  const isAdmin = callerHasEmailViewPrivate(userFeatures)

  // Only the author or an admin (with view-private) may flip visibility. Return
  // 404 (not 403) for everyone else so we don't leak the row's existence — this
  // also covers non-authors who cannot see a private email in the first place.
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }

  // No-op: visibility is already at the requested value.
  if (interaction.visibility === body.visibility) {
    return NextResponse.json({ ok: true, changed: false })
  }

  const previousVisibility = (interaction.visibility ?? 'private') as 'private' | 'shared'
  interaction.visibility = body.visibility
  await em.flush()

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
      adminBypass: !isAuthor && isAdmin,
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
