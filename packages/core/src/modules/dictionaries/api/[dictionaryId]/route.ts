import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dictionariesErrorSchema,
  dictionariesOkSchema,
  dictionariesTag,
  dictionaryDetailSchema,
  dictionaryIdParamsSchema,
  dictionaryUpdateSchema,
  upsertDictionarySchema,
} from '../openapi'

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })
const updateSchema = upsertDictionarySchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dictionaries.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

function isProtectedCurrencyDictionary(dictionary: Dictionary) {
  const key = dictionary.key?.trim().toLowerCase() ?? ''
  return key === 'currency' || key === 'currencies'
}

async function loadDictionary(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  id: string,
  options: { allowInherited?: boolean } = {},
) {
  const { allowInherited = false } = options
  if (!allowInherited && !context.organizationId) {
    throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
  }
  const baseFilter = {
    id,
    tenantId: context.tenantId,
    deletedAt: null,
  }
  const filter = allowInherited
    ? {
        ...baseFilter,
        ...(context.readableOrganizationIds.length
          ? { organizationId: { $in: context.readableOrganizationIds } }
          : {}),
      }
    : {
        ...baseFilter,
        organizationId: context.organizationId,
      }
  const dictionary = await context.em.findOne(Dictionary, filter)
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

export async function GET(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId, { allowInherited: true })
    return NextResponse.json({
      id: dictionary.id,
      key: dictionary.key,
      name: dictionary.name,
      description: dictionary.description,
      isSystem: dictionary.isSystem,
      isActive: dictionary.isActive,
      managerVisibility: dictionary.managerVisibility,
      organizationId: dictionary.organizationId,
      isInherited: context.organizationId ? dictionary.organizationId !== context.organizationId : false,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load dictionary' }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const payload = updateSchema.parse(await req.json().catch(() => ({})))
    const dictionary = await loadDictionary(context, dictionaryId)

    if (isProtectedCurrencyDictionary(dictionary)) {
      if (payload.key && payload.key.trim().toLowerCase() !== dictionary.key) {
        throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.currency_protected', 'The currency dictionary cannot be modified or deleted.') })
      }
      if (payload.isActive === false) {
        throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.currency_protected', 'The currency dictionary cannot be modified or deleted.') })
      }
    }

    if (payload.key) {
      const key = payload.key.trim().toLowerCase()
      if (key !== dictionary.key) {
        const organizationId = context.organizationId
        if (!organizationId) {
          throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
        }
        const existing = await context.em.findOne(Dictionary, {
          key,
          organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        })
        if (existing) {
          throw new CrudHttpError(409, { error: context.translate('dictionaries.errors.duplicate', 'A dictionary with this key already exists') })
        }
        dictionary.key = key
      }
    }

    if (payload.name) {
      dictionary.name = payload.name.trim()
    }
    if (payload.description !== undefined) {
      dictionary.description = payload.description ? payload.description.trim() : null
    }
    if (payload.isActive !== undefined) {
      dictionary.isActive = Boolean(payload.isActive)
      if (!dictionary.isActive) {
        dictionary.deletedAt = dictionary.deletedAt ?? new Date()
      } else {
        dictionary.deletedAt = null
      }
    }

    dictionary.updatedAt = new Date()
    await context.em.flush()

    return NextResponse.json({
      id: dictionary.id,
      key: dictionary.key,
      name: dictionary.name,
      description: dictionary.description,
      isSystem: dictionary.isSystem,
      isActive: dictionary.isActive,
      managerVisibility: dictionary.managerVisibility,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id.PATCH] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to update dictionary' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId)

    if (isProtectedCurrencyDictionary(dictionary)) {
      throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.currency_protected', 'The currency dictionary cannot be modified or deleted.') })
    }

    dictionary.isActive = false
    dictionary.deletedAt = dictionary.deletedAt ?? new Date()
    await context.em.flush()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id.DELETE] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to delete dictionary' }, { status: 500 })
  }
}

const dictionaryGetDoc: OpenApiMethodDoc = {
  summary: 'Get dictionary',
  description: 'Returns details for the specified dictionary, including inheritance flags.',
  tags: [dictionariesTag],
  responses: [
    { status: 200, description: 'Dictionary details.', schema: dictionaryDetailSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid parameters', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to load dictionary', schema: dictionariesErrorSchema },
  ],
}

const dictionaryPatchDoc: OpenApiMethodDoc = {
  summary: 'Update dictionary',
  description: 'Updates mutable attributes of the dictionary. Currency dictionaries are protected from modification.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: dictionaryUpdateSchema,
    description: 'Fields to update on the dictionary.',
  },
  responses: [
    { status: 200, description: 'Dictionary updated.', schema: dictionaryDetailSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed or protected dictionary', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 409, description: 'Dictionary key already exists', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to update dictionary', schema: dictionariesErrorSchema },
  ],
}

const dictionaryDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete dictionary',
  description: 'Soft deletes the dictionary unless it is the protected currency dictionary.',
  tags: [dictionariesTag],
  responses: [
    { status: 200, description: 'Dictionary archived.', schema: dictionariesOkSchema },
  ],
  errors: [
    { status: 400, description: 'Protected dictionary cannot be deleted', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to delete dictionary', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Dictionary resource',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    GET: dictionaryGetDoc,
    PATCH: dictionaryPatchDoc,
    DELETE: dictionaryDeleteDoc,
  },
}
