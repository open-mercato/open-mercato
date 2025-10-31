import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { createDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createDictionaryEntrySchema as createEntryDocSchema,
  dictionaryEntryListResponseSchema,
  dictionaryEntryResponseSchema,
  dictionaryIdParamsSchema,
  dictionariesErrorSchema,
  dictionariesTag,
} from '../../openapi'

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })

async function loadDictionary(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  id: string,
  options: { allowInherited?: boolean } = {},
) {
  const { allowInherited = false } = options
  const dictionary = await context.em.findOne(Dictionary, {
    id,
    organizationId: allowInherited ? { $in: context.readableOrganizationIds } : context.organizationId,
    tenantId: context.tenantId,
    deletedAt: null,
  })
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dictionaries.view'] },
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function GET(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const dictionary = await loadDictionary(context, dictionaryId, { allowInherited: true })
    const entries = await context.em.find(
      DictionaryEntry,
      {
        dictionary,
        organizationId: dictionary.organizationId,
        tenantId: dictionary.tenantId,
      },
      { orderBy: { label: 'asc' } },
    )

    return NextResponse.json({
      items: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load dictionary entries' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })
    const payload = createDictionaryEntrySchema.parse(await req.json().catch(() => ({})))
    // These nested routes do not use makeCrudRoute, so we invoke the command bus directly.
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('dictionaries.entries.create', {
      input: { ...payload, dictionaryId },
      ctx: context.ctx,
    })
    const createResult = (result ?? {}) as { entryId?: string | null }
    const createdEntryId = typeof createResult.entryId === 'string' ? createResult.entryId : null
    if (!createdEntryId) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_create_failed', 'Failed to create dictionary entry') })
    }
    const entry = await context.em.fork().findOne(DictionaryEntry, createdEntryId, { populate: ['dictionary'] })
    if (!entry) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_create_failed', 'Failed to create dictionary entry') })
    }
    const response = NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }, { status: 201 })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'dictionaries.entry',
          resourceId: createdEntryId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries.POST] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to create dictionary entry' }, { status: 500 })
  }
}

const dictionaryEntriesGetDoc: OpenApiMethodDoc = {
  summary: 'List dictionary entries',
  description: 'Returns entries for the specified dictionary ordered alphabetically.',
  tags: [dictionariesTag],
  responses: [
    { status: 200, description: 'Dictionary entries.', schema: dictionaryEntryListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid parameters', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to load dictionary entries', schema: dictionariesErrorSchema },
  ],
}

const dictionaryEntriesPostDoc: OpenApiMethodDoc = {
  summary: 'Create dictionary entry',
  description: 'Creates a new entry in the specified dictionary.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: createEntryDocSchema,
    description: 'Entry value, label, and optional presentation metadata.',
  },
  responses: [
    { status: 201, description: 'Dictionary entry created.', schema: dictionaryEntryResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to create dictionary entry', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Dictionary entries collection',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    GET: dictionaryEntriesGetDoc,
    POST: dictionaryEntriesPostDoc,
  },
}
