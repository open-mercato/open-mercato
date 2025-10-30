import { NextResponse } from 'next/server'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dictionariesErrorSchema,
  dictionariesTag,
  dictionaryDetailSchema,
  dictionaryListQuerySchema,
  dictionaryListResponseSchema,
  upsertDictionarySchema,
} from './openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dictionaries.view'] },
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function GET(req: Request) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const url = new URL(req.url)
    const includeInactive = (url.searchParams.get('includeInactive') ?? '').toLowerCase() === 'true'

    const items = await context.em.find(
      Dictionary,
      {
        organizationId: { $in: context.readableOrganizationIds },
        tenantId: context.tenantId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      { orderBy: { name: 'asc' } },
    )

    return NextResponse.json({
      items: items.map((dictionary) => ({
        id: dictionary.id,
        key: dictionary.key,
        name: dictionary.name,
        description: dictionary.description,
        isSystem: dictionary.isSystem,
        isActive: dictionary.isActive,
        managerVisibility: dictionary.managerVisibility,
        organizationId: dictionary.organizationId,
        isInherited: dictionary.organizationId !== context.organizationId,
        createdAt: dictionary.createdAt,
        updatedAt: dictionary.updatedAt,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load dictionaries' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const payload = upsertDictionarySchema.parse(await req.json().catch(() => ({})))
    const key = payload.key.trim().toLowerCase()

    const existing = await context.em.findOne(Dictionary, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      key,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(409, { error: context.translate('dictionaries.errors.duplicate', 'A dictionary with this key already exists') })
    }

    const dictionary = context.em.create(Dictionary, {
      key,
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      isSystem: payload.isSystem ?? false,
      isActive: payload.isActive ?? true,
      managerVisibility: 'default',
    })
    context.em.persist(dictionary)
    await context.em.flush()

    return NextResponse.json({
      id: dictionary.id,
      key: dictionary.key,
      name: dictionary.name,
      description: dictionary.description,
      isSystem: dictionary.isSystem,
      isActive: dictionary.isActive,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt,
    }, { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries.POST] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to create dictionary' }, { status: 500 })
  }
}

const dictionariesGetDoc: OpenApiMethodDoc = {
  summary: 'List dictionaries',
  description: 'Returns dictionaries accessible to the current organization, optionally including inactive records.',
  tags: [dictionariesTag],
  query: dictionaryListQuerySchema,
  responses: [
    { status: 200, description: 'Dictionary collection.', schema: dictionaryListResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to load dictionaries', schema: dictionariesErrorSchema },
  ],
}

const dictionariesPostDoc: OpenApiMethodDoc = {
  summary: 'Create dictionary',
  description: 'Registers a dictionary scoped to the current organization.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: upsertDictionarySchema,
    description: 'Dictionary definition including unique key and display name.',
  },
  responses: [
    { status: 201, description: 'Dictionary created.', schema: dictionaryDetailSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 409, description: 'Dictionary key already exists', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to create dictionary', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Dictionaries collection',
  methods: {
    GET: dictionariesGetDoc,
    POST: dictionariesPostDoc,
  },
}
