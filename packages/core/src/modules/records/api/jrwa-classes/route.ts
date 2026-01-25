import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { RecordsJrwaClass } from '../../data/entities'
import { jrwaClassCreateSchema, jrwaClassUpdateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createRecordsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['records.jrwa_classes.view'] },
  POST: { requireAuth: true, requireFeatures: ['records.jrwa_classes.create'] },
  PUT: { requireAuth: true, requireFeatures: ['records.jrwa_classes.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['records.jrwa_classes.delete'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    version: z.coerce.number().int().min(1).optional(),
    parentId: z.string().uuid().optional(),
  })
  .passthrough()

type JrwaClassRow = {
  id: string
  code: string
  name: string
  parentId: string | null
  retentionYears: number | null
  retentionCategory: string | null
  version: number
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

function toRow(entity: RecordsJrwaClass): JrwaClassRow {
  return {
    id: String(entity.id),
    code: String(entity.code),
    name: String(entity.name),
    parentId: entity.parentId ?? null,
    retentionYears: entity.retentionYears ?? null,
    retentionCategory: entity.retentionCategory ?? null,
    version: Number(entity.version ?? 1),
    isActive: !!entity.isActive,
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : null,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
  }
}

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const url = new URL(request.url)
  const parsed = listSchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    version: url.searchParams.get('version') ?? undefined,
    parentId: url.searchParams.get('parentId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const { page, pageSize, search, version, parentId } = parsed.data
  const where: FilterQuery<RecordsJrwaClass> = {
    organizationId,
    tenantId,
    deletedAt: null,
  }
  if (typeof version === 'number') where.version = version
  if (parentId) where.parentId = parentId
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    where.$or = [{ code: { $ilike: pattern } }, { name: { $ilike: pattern } }]
  }

  const offset = (page - 1) * pageSize
  const [items, total] = await em.findAndCount(RecordsJrwaClass, where, {
    orderBy: { code: 'ASC' },
    limit: pageSize,
    offset,
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return NextResponse.json({ items: items.map(toRow), total, page, pageSize, totalPages })
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: RecordsJrwaClass,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  create: {
    schema: jrwaClassCreateSchema,
    mapToEntity: (input) => ({
      ...input,
      version: input.version ?? 1,
      isActive: input.isActive !== false,
    }),
    response: (entity) => ({ id: String(entity?.id ?? null) }),
  },
  update: {
    schema: jrwaClassUpdateSchema,
    applyToEntity: (entity: RecordsJrwaClass, input) => {
      if (input.code !== undefined) entity.code = input.code
      if (input.name !== undefined) entity.name = input.name
      if (input.parentId !== undefined) entity.parentId = input.parentId
      if (input.retentionYears !== undefined) entity.retentionYears = input.retentionYears
      if (input.retentionCategory !== undefined) entity.retentionCategory = input.retentionCategory
      if (input.version !== undefined) entity.version = input.version
      if (input.isActive !== undefined) entity.isActive = input.isActive
    },
    response: () => ({ ok: true }),
  },
  del: {
    response: () => ({ ok: true }),
  },
})

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const jrwaClassListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  retentionYears: z.number().int().nullable(),
  retentionCategory: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createRecordsCrudOpenApi({
  resourceName: 'JRWA class',
  pluralName: 'JRWA classes',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(jrwaClassListItemSchema),
  create: {
    schema: jrwaClassCreateSchema,
    description: 'Creates a JRWA class (node).',
  },
  update: {
    schema: jrwaClassUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a JRWA class by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a JRWA class by id.',
  },
})
