import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { CustomerEntity } from '../../../../data/entities'
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
  const em = (container.resolve('em') as EntityManager).fork()

  // Verify the Person exists in the caller's tenant, then fail-closed on the
  // record's own organization — same pattern as the [id] detail route. Loading
  // by tenant + id (not a hand-rolled selected org) keeps this working under the
  // "All organizations" scope, where no concrete org is carried.
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: personId,
      kind: 'person',
      tenantId: auth.tenantId,
      deletedAt: null,
    } as never,
    undefined,
    { tenantId: auth.tenantId as string, organizationId: scope?.selectedId ?? (auth as { orgId?: string | null }).orgId ?? null },
  )
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }
  const organizationId = (person as { organizationId?: string | null }).organizationId ?? null
  if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId })) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  const viewerUserId = auth.isApiKey ? null : auth.sub ?? null

  const threads = await buildPersonEmailThreads(em, {
    personId,
    tenantId: auth.tenantId as string,
    organizationId,
    viewerUserId,
    // The v1 visibility filter is owner-only and ignores `userFeatures`; match
    // the sibling read routes (people/[id], interactions) by passing `undefined`
    // rather than paying an RBAC round-trip the filter discards.
    userFeatures: undefined,
  })

  return NextResponse.json({ threads })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    GET: {
      summary: 'List a Person\'s email threads (Gmail-style conversation grouping)',
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
