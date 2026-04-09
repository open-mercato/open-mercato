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
  removePersonCompanyLink,
  updatePersonCompanyLink,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const paramsSchema = z.object({
  id: z.string().uuid(),
  linkId: z.string().uuid(),
})

const updateSchema = z.object({
  isPrimary: z.boolean().optional(),
})

const updateResponseSchema = z.object({
  ok: z.literal(true),
  result: z
    .object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    })
    .nullable(),
})

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    PATCH: {
      summary: 'Update a linked company for a person',
      requestBody: { schema: updateSchema },
      responses: [{ status: 200, description: 'Updated company link', schema: updateResponseSchema }],
    },
    DELETE: {
      summary: 'Remove a linked company from a person',
      responses: [{ status: 200, description: 'Deletion result', schema: z.object({ ok: z.literal(true) }) }],
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

export async function PATCH(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const payload = updateSchema.parse(await req.json())
    const { em, person, profile } = await loadPersonContext(req, id)
    const link = await updatePersonCompanyLink(em, person, profile, linkId, payload)
    await em.flush()
    const company = link && typeof link.company !== 'string' ? link.company : null
    return NextResponse.json({
      ok: true,
      result: link
        ? {
            id: link.id,
            companyId: company?.id ?? '',
            displayName: company?.displayName ?? '',
            isPrimary: Boolean(link.isPrimary),
          }
        : null,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const { em, person, profile } = await loadPersonContext(req, id)
    await removePersonCompanyLink(em, person, profile, linkId)
    await em.flush()
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
