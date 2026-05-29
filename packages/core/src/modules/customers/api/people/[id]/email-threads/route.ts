import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerEntity } from '../../../../data/entities'
import { resolveAuthActorId } from '../../../../lib/interactionRequestContext'
import { buildPersonEmailThreads } from '../../../../lib/personEmailThreads'

export const metadata = {
  path: '/customers/people/[id]/email-threads',
  GET: {
    requireAuth: true,
    requireFeatures: ['customers.people.view'],
  },
}

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[] | undefined>
}

async function resolveUserFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return undefined
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { id: personId } = await context.params
  if (!z.string().uuid().safeParse(personId).success) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? (auth as { orgId?: string | null }).orgId ?? null
  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  // Verify the Person exists in the caller's tenant/org (ownership check,
  // same pattern as the [id]/emails compose route).
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: personId,
      kind: 'person',
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    } as never,
    undefined,
    dscope,
  )
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const viewerUserId = resolveAuthActorId(auth)
  const userFeatures = await resolveUserFeatures(
    container,
    viewerUserId,
    auth.tenantId as string,
    organizationId,
  )

  const threads = await buildPersonEmailThreads(em, {
    personId,
    tenantId: auth.tenantId as string,
    organizationId,
    viewerUserId,
    userFeatures,
  })

  return NextResponse.json({ threads })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    GET: {
      summary: 'List a Person\'s email threads (Gmail/Outlook-style conversation grouping)',
      tags: ['Customers', 'Email'],
      responses: [
        { status: 200, description: 'Email threads for the person, grouped by conversation' },
        { status: 400, description: 'Invalid person id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing customers.people.view feature' },
        { status: 404, description: 'Person not found' },
      ],
    },
  },
}

export default GET
