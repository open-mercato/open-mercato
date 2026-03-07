import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerSavedView } from '../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const entityTypeEnum = z.enum(['deal', 'person', 'company'])

const createSchema = z.object({
  entityType: entityTypeEnum,
  name: z.string().trim().min(1).max(100),
  filters: z.record(z.string(), z.unknown()).default({}),
  sortField: z.string().max(100).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  columns: z.array(z.string().max(100)).optional(),
  isDefault: z.boolean().optional(),
  isShared: z.boolean().optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
}).merge(createSchema.partial())

const deleteSchema = z.object({
  id: z.string().uuid(),
})

async function resolveAuth(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    throw new CrudHttpError(401, { error: 'Authentication required' })
  }
  return { container, auth }
}

async function checkFeature(container: ReturnType<typeof createRequestContainer> extends Promise<infer T> ? T : never, auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null }, features: string[]) {
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

export async function GET(request: Request) {
  try {
    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const em = (container.resolve('em') as EntityManager)
    const url = new URL(request.url)
    const entityType = url.searchParams.get('entityType') ?? 'deal'
    const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

    const views = await findWithDecryption(
      em,
      CustomerSavedView,
      {
        $or: [
          { userId: auth.sub, entityType, deletedAt: null },
          ...(auth.orgId ? [{ organizationId: auth.orgId, entityType, isShared: true, deletedAt: null }] : []),
        ],
      },
      { orderBy: { createdAt: 'DESC' } },
      decryptionScope,
    )

    return NextResponse.json({
      items: views.map((view) => ({
        id: view.id,
        entityType: view.entityType,
        name: view.name,
        filters: view.filters,
        sortField: view.sortField ?? null,
        sortDir: view.sortDir ?? null,
        columns: view.columns ?? null,
        isDefault: view.isDefault,
        isShared: view.isShared,
        userId: view.userId,
        createdAt: view.createdAt.toISOString(),
        updatedAt: view.updatedAt.toISOString(),
      })),
      total: views.length,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const body = await request.json()
    const parsed = createSchema.parse(body)

    if (parsed.isShared) {
      await checkFeature(container, auth, ['customers.saved-views.manage'])
    }

    const em = (container.resolve('em') as EntityManager)
    const view = em.create(CustomerSavedView, {
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
      userId: auth.sub!,
      entityType: parsed.entityType,
      name: parsed.name,
      filters: parsed.filters,
      sortField: parsed.sortField ?? null,
      sortDir: parsed.sortDir ?? null,
      columns: parsed.columns ?? null,
      isDefault: parsed.isDefault ?? false,
      isShared: parsed.isShared ?? false,
    })
    em.persist(view)

    if (parsed.isDefault) {
      await em.nativeUpdate(
        CustomerSavedView,
        {
          userId: auth.sub!,
          entityType: parsed.entityType,
          isDefault: true,
          id: { $ne: view.id },
          deletedAt: null,
        },
        { isDefault: false },
      )
    }

    await em.flush()

    return NextResponse.json({
      id: view.id,
      ok: true,
    }, { status: 201 })
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

export async function PUT(request: Request) {
  try {
    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const body = await request.json()
    const parsed = updateSchema.parse(body)

    const em = (container.resolve('em') as EntityManager)
    const view = await em.findOne(CustomerSavedView, { id: parsed.id, deletedAt: null })
    if (!view) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    if (view.userId !== auth.sub && !view.isShared) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (view.isShared || parsed.isShared) {
      await checkFeature(container, auth, ['customers.saved-views.manage'])
    }

    if (parsed.name !== undefined) view.name = parsed.name
    if (parsed.filters !== undefined) view.filters = parsed.filters
    if (parsed.sortField !== undefined) view.sortField = parsed.sortField ?? null
    if (parsed.sortDir !== undefined) view.sortDir = parsed.sortDir ?? null
    if (parsed.columns !== undefined) view.columns = parsed.columns ?? null
    if (parsed.isDefault !== undefined) view.isDefault = parsed.isDefault
    if (parsed.isShared !== undefined) view.isShared = parsed.isShared

    if (parsed.isDefault) {
      await em.nativeUpdate(
        CustomerSavedView,
        {
          userId: view.userId,
          entityType: view.entityType,
          isDefault: true,
          id: { $ne: view.id },
          deletedAt: null,
        },
        { isDefault: false },
      )
    }

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

export async function DELETE(request: Request) {
  try {
    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const body = await request.json()
    const parsed = deleteSchema.parse(body)

    const em = (container.resolve('em') as EntityManager)
    const view = await em.findOne(CustomerSavedView, { id: parsed.id, deletedAt: null })
    if (!view) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    if (view.userId !== auth.sub) {
      if (!view.isShared) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      await checkFeature(container, auth, ['customers.saved-views.manage'])
    }

    view.deletedAt = new Date()
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
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Saved views',
  methods: {
    GET: {
      summary: 'List saved views',
      description: 'Returns saved views for the current user and shared views in the organization.',
      responses: [
        { status: 200, description: 'List of saved views' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
    POST: {
      summary: 'Create saved view',
      description: 'Creates a new saved view with filter, sort, and column configuration.',
      responses: [
        { status: 201, description: 'View created' },
        { status: 400, description: 'Validation error' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
    PUT: {
      summary: 'Update saved view',
      description: 'Updates an existing saved view.',
      responses: [
        { status: 200, description: 'View updated' },
        { status: 400, description: 'Validation error' },
        { status: 404, description: 'View not found' },
      ],
    },
    DELETE: {
      summary: 'Delete saved view',
      description: 'Soft-deletes a saved view.',
      responses: [
        { status: 200, description: 'View deleted' },
        { status: 404, description: 'View not found' },
      ],
    },
  },
}
