import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { updateDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dictionaryEntryParamsSchema,
  dictionaryEntryResponseSchema,
  dictionariesErrorSchema,
  dictionariesOkSchema,
  dictionariesTag,
  updateDictionaryEntrySchema as updateEntryDocSchema,
} from '../../../openapi'
const paramsSchema = z.object({
  dictionaryId: z.string().uuid(),
  entryId: z.string().uuid(),
})

async function loadDictionary(context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>, id: string) {
  if (!context.organizationId) {
    throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
  }
  const dictionary = await context.em.findOne(Dictionary, {
    id,
    organizationId: context.organizationId,
    tenantId: context.tenantId,
    deletedAt: null,
  })
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}

async function loadEntry(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  dictionary: Dictionary,
  entryId: string,
) {
  const entry = await context.em.findOne(DictionaryEntry, {
    id: entryId,
    dictionary,
    organizationId: dictionary.organizationId,
    tenantId: context.tenantId,
  })
  if (!entry) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.entry_not_found', 'Dictionary entry not found') })
  }
  return entry
}

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function PATCH(req: Request, ctx: { params?: { dictionaryId?: string; entryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId, entryId } = paramsSchema.parse({
      dictionaryId: ctx.params?.dictionaryId,
      entryId: ctx.params?.entryId,
    })
    const dictionary = await loadDictionary(context, dictionaryId)
    await loadEntry(context, dictionary, entryId)
    const rawBody = await req.json().catch(() => ({}))
    const payload = updateDictionaryEntrySchema.parse(rawBody)
    // These nested routes don't use the CRUD factory, so invoke the command bus explicitly.
    const commandBus = (context.container.resolve('commandBus') as CommandBus)
    const input = { ...(payload as Record<string, unknown>), id: entryId }
    const { result, logEntry } = await commandBus.execute('dictionaries.entries.update', {
      input,
      ctx: context.ctx,
    })
    const updateResult = (result ?? {}) as { entryId?: string | null }
    const updatedEntryId = typeof updateResult.entryId === 'string' ? updateResult.entryId : null
    if (!updatedEntryId) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_update_failed', 'Failed to update dictionary entry') })
    }
    const updated = await context.em.fork().findOne(DictionaryEntry, updatedEntryId, { populate: ['dictionary'] })
    if (!updated) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_update_failed', 'Failed to update dictionary entry') })
    }
    const response = NextResponse.json({
      id: updated.id,
      value: updated.value,
      label: updated.label,
      color: updated.color,
      icon: updated.icon,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'dictionaries.entry',
          resourceId: updatedEntryId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries/:entryId.PATCH] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to update dictionary entry' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { dictionaryId?: string; entryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { dictionaryId, entryId } = paramsSchema.parse({
      dictionaryId: ctx.params?.dictionaryId,
      entryId: ctx.params?.entryId,
    })
    const dictionary = await loadDictionary(context, dictionaryId)
    const entry = await loadEntry(context, dictionary, entryId)
    const commandBus = (context.container.resolve('commandBus') as CommandBus)
    const { logEntry } = await commandBus.execute('dictionaries.entries.delete', {
      input: { body: { id: entry.id } },
      ctx: context.ctx,
    })
    const response = NextResponse.json({ ok: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'dictionaries.entry',
          resourceId: entry.id,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries/:entryId.DELETE] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to delete dictionary entry' }, { status: 500 })
  }
}

const dictionaryEntryPatchDoc: OpenApiMethodDoc = {
  summary: 'Update dictionary entry',
  description: 'Updates the specified dictionary entry using the command bus pipeline.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: updateEntryDocSchema,
    description: 'Fields to update on the dictionary entry.',
  },
  responses: [
    { status: 200, description: 'Dictionary entry updated.', schema: dictionaryEntryResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary or entry not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to update entry', schema: dictionariesErrorSchema },
  ],
}

const dictionaryEntryDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete dictionary entry',
  description: 'Deletes the specified dictionary entry via the command bus.',
  tags: [dictionariesTag],
  responses: [
    { status: 200, description: 'Entry deleted.', schema: dictionariesOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary or entry not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to delete entry', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Dictionary entry resource',
  pathParams: dictionaryEntryParamsSchema,
  methods: {
    PATCH: dictionaryEntryPatchDoc,
    DELETE: dictionaryEntryDeleteDoc,
  },
}
