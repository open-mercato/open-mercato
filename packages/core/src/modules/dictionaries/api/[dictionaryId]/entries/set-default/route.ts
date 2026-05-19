import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import {
  setDefaultDictionaryEntryCommandSchema,
  setDefaultDictionaryEntrySchema,
  type SetDefaultDictionaryEntryCommandInput,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  dictionaryIdParamsSchema,
  dictionariesErrorSchema,
  dictionariesOkSchema,
  dictionariesTag,
  setDefaultEntryRequestSchema,
} from '../../../openapi'
import { resolveDictionaryActorId } from '../../../context'

const paramsSchema = z.object({ dictionaryId: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['dictionaries.manage'] },
}

export async function POST(req: Request, ctx: { params?: { dictionaryId?: string } }) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    if (!context.auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { dictionaryId } = paramsSchema.parse({ dictionaryId: ctx.params?.dictionaryId })

    if (!context.organizationId) {
      throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
    }
    const dictionaryEm = context.em.fork()
    const dictionary = await findOneWithDecryption(
      dictionaryEm,
      Dictionary,
      {
        id: dictionaryId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      undefined,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    if (!dictionary) {
      throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
    }

    const payload = setDefaultDictionaryEntrySchema.parse(await readJsonSafe(req, {}))
    const guardUserId = resolveDictionaryActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'dictionaries.dictionary',
      resourceId: dictionaryId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandInput = setDefaultDictionaryEntryCommandSchema.parse({
      dictionaryId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      entryId: payload.entryId,
    } satisfies SetDefaultDictionaryEntryCommandInput)

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<SetDefaultDictionaryEntryCommandInput, { dictionaryId: string; entryId: string; clearedIds: string[] }>(
      'dictionaries.entries.set_default',
      {
        input: commandInput,
        ctx: context.ctx,
      },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'dictionaries.dictionary',
        resourceId: dictionaryId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const response = NextResponse.json({ ok: true })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'dictionaries.dictionary',
          resourceId: logEntry.resourceId ?? dictionaryId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[dictionaries/:id/entries/set-default.POST] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to set default entry' }, { status: 500 })
  }
}

const setDefaultPostDoc: OpenApiMethodDoc = {
  summary: 'Set default dictionary entry',
  description: 'Marks the specified entry as the default for this dictionary, clearing any previous default.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: setDefaultEntryRequestSchema,
    description: 'ID of the entry to set as default.',
  },
  responses: [
    { status: 200, description: 'Default entry set.', schema: dictionariesOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary or entry not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to set default entry', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Set default dictionary entry',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    POST: setDefaultPostDoc,
  },
}
