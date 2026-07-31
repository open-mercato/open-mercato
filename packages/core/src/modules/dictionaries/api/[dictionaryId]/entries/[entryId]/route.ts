import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext, resolveDictionaryActorId } from '@open-mercato/core/modules/dictionaries/api/context'
import { updateDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  dictionaryEntryParamsSchema,
  dictionaryEntryResponseSchema,
  dictionariesErrorSchema,
  dictionariesOkSchema,
  dictionariesTag,
  updateDictionaryEntrySchema as updateEntryDocSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dictionaries').child({ component: 'entries-api' })
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
    if (!context.auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { dictionaryId, entryId } = paramsSchema.parse({
      dictionaryId: ctx.params?.dictionaryId,
      entryId: ctx.params?.entryId,
    })
    const dictionary = await loadDictionary(context, dictionaryId)
    const entry = await loadEntry(context, dictionary, entryId)
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'dictionaries.entry',
      resourceId: entry.id,
      current: entry.updatedAt ?? null,
      request: req,
    })
    const rawBody = await req.json().catch(() => ({}))
    const payload = updateDictionaryEntrySchema.parse(rawBody)
    const guardUserId = resolveDictionaryActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'dictionaries.entry',
      resourceId: entry.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
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
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'dictionaries.entry',
        resourceId: updatedEntryId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const updated = await findOneWithDecryption(
      context.em.fork(),
      DictionaryEntry,
      updatedEntryId,
      { populate: ['dictionary'] },
      { tenantId: context.auth.tenantId ?? null, organizationId: context.auth.orgId ?? null },
    )
    if (!updated) {
      throw new CrudHttpError(500, { error: context.translate('dictionaries.errors.entry_update_failed', 'Failed to update dictionary entry') })
    }
    const response = NextResponse.json({
      id: updated.id,
      value: updated.value,
      label: updated.label,
      color: updated.color,
      icon: updated.icon,
      position: updated.position ?? 0,
      isDefault: updated.isDefault ?? false,
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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to update dictionary entry', { err })
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
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: 'dictionaries.entry',
      resourceId: entry.id,
      current: entry.updatedAt ?? null,
      request: req,
    })

    const guardUserId = resolveDictionaryActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'dictionaries.entry',
      resourceId: entry.id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: null,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = (context.container.resolve('commandBus') as CommandBus)
    const { logEntry } = await commandBus.execute('dictionaries.entries.delete', {
      input: { body: { id: entry.id } },
      ctx: context.ctx,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'dictionaries.entry',
        resourceId: entry.id,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to delete dictionary entry', { err })
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
