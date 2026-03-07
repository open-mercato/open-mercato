import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealPersonLink } from '../../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const updateRoleSchema = z.object({
  personId: z.string().uuid(),
  role: z.string().max(100).nullable(),
})

async function resolveAuth(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    throw new CrudHttpError(401, { error: 'Authentication required' })
  }
  return { container, auth }
}

async function checkFeature(container: Awaited<ReturnType<typeof createRequestContainer>>, auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null }, features: string[]) {
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }
  if (!rbac || !auth?.sub) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, features, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const em = (container.resolve('em') as EntityManager)
    const deal = await em.findOne(CustomerDeal, { id: parsedParams.data.id, deletedAt: null })
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const decryptionScope = {
      tenantId: deal.tenantId ?? auth.tenantId ?? null,
      organizationId: deal.organizationId ?? auth.orgId ?? null,
    }

    const links = await findWithDecryption(
      em,
      CustomerDealPersonLink,
      { deal: deal.id },
      { populate: ['person'] },
      decryptionScope,
    )

    const contacts = links.map((link) => {
      const person = link.person
      const personId = typeof person === 'string'
        ? person
        : person && typeof person === 'object' && 'id' in person
          ? (person as { id: string }).id
          : null
      const displayName = person && typeof person === 'object' && 'displayName' in person
        ? (person as { displayName: string }).displayName
        : null
      return {
        id: link.id,
        personId,
        label: displayName ?? personId ?? '',
        role: link.participantRole ?? null,
      }
    })

    return NextResponse.json({ contacts })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.manage'])

    const body = await request.json()
    const parsed = updateRoleSchema.parse(body)

    const em = (container.resolve('em') as EntityManager)
    const deal = await em.findOne(CustomerDeal, { id: parsedParams.data.id, deletedAt: null })
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const link = await em.findOne(CustomerDealPersonLink, {
      deal: deal.id,
      person: parsed.personId,
    })
    if (!link) {
      return NextResponse.json({ error: 'Contact not linked to this deal' }, { status: 404 })
    }

    link.participantRole = parsed.role
    await em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const metadata = {
  methods: ['GET', 'PUT'],
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
}

export const openApi: OpenApiRouteDoc = {
  get: {
    summary: 'List deal contacts with roles',
    description: 'Returns all people linked to a deal with their participant roles.',
    tags: ['Customers'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      200: { description: 'List of contacts' },
      404: { description: 'Deal not found' },
    },
  },
  put: {
    summary: 'Update deal contact role',
    description: 'Sets the participant role for a person linked to a deal.',
    tags: ['Customers'],
    responses: {
      200: { description: 'Role updated' },
      400: { description: 'Validation error' },
      404: { description: 'Contact or deal not found' },
    },
  },
}
