import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  addPersonCompanyLink,
  loadPersonCompanyLinks,
  summarizePersonCompanies,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createSchema = z.object({
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
})

const listResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
})

const createResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    displayName: z.string(),
    isPrimary: z.boolean(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked companies for a person',
      responses: [{ status: 200, description: 'Linked company rows', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Link a company to a person',
      requestBody: { schema: createSchema },
      responses: [{ status: 200, description: 'Linked company row', schema: createResponseSchema }],
    },
  },
}

async function loadPersonContext(req: Request, personId: string) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = (container.resolve('em') as EntityManager).fork()
  const person = await em.findOne(CustomerEntity, { id: personId, kind: 'person', deletedAt: null })

  if (!person || person.tenantId !== auth.tenantId) {
    throw new CrudHttpError(404, { error: 'Person not found' })
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size > 0 && !allowedOrgIds.has(person.organizationId)) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }

  const profile = await em.findOne(CustomerPersonProfile, { entity: person }, { populate: ['company'] })
  if (!profile) {
    throw new CrudHttpError(404, { error: 'Person profile not found' })
  }

  return { em, person, profile }
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const { em, person, profile } = await loadPersonContext(req, id)
    const links = await loadPersonCompanyLinks(em, person)
    const items = summarizePersonCompanies(profile, links).map((entry) => ({
      id: entry.linkId ?? entry.companyId,
      companyId: entry.companyId,
      displayName: entry.displayName,
      isPrimary: entry.isPrimary,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = createSchema.parse(await req.json())
    const { em, person, profile } = await loadPersonContext(req, id)
    const link = await addPersonCompanyLink(em, person, profile, payload.companyId, {
      isPrimary: payload.isPrimary,
    })
    await em.flush()
    const company = typeof link.company === 'string' ? null : link.company
    return NextResponse.json({
      ok: true,
      result: {
        id: link.id,
        companyId: company?.id ?? payload.companyId,
        displayName: company?.displayName ?? '',
        isPrimary: Boolean(link.isPrimary),
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
