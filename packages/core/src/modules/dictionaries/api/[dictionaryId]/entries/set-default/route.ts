import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { setDefaultDictionaryEntrySchema } from '@open-mercato/core/modules/dictionaries/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
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
    const dictionary = await context.em.findOne(Dictionary, {
      id: dictionaryId,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })
    if (!dictionary) {
      throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
    }

    const payload = setDefaultDictionaryEntrySchema.parse(await req.json().catch(() => ({})))
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

    const em = context.em.fork()

    // Verify the target entry exists and belongs to this dictionary
    const targetEntry = await em.findOne(DictionaryEntry, {
      id: payload.entryId,
      dictionary,
      organizationId: dictionary.organizationId,
      tenantId: dictionary.tenantId,
    })
    if (!targetEntry) {
      throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.entry_not_found', 'Dictionary entry not found') })
    }

    // Clear all existing defaults for this dictionary atomically
    const allEntries = await em.find(DictionaryEntry, {
      dictionary,
      organizationId: dictionary.organizationId,
      tenantId: dictionary.tenantId,
      isDefault: true,
    })
    for (const entry of allEntries) {
      entry.isDefault = false
      entry.updatedAt = new Date()
    }

    // Set the target as default
    targetEntry.isDefault = true
    targetEntry.updatedAt = new Date()

    await em.flush()

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

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
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
