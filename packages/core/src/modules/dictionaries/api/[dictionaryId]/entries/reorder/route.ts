import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { reorderDictionaryEntriesSchema } from '@open-mercato/core/modules/dictionaries/data/validators'
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
  reorderEntriesRequestSchema,
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

    const payload = reorderDictionaryEntriesSchema.parse(await req.json().catch(() => ({})))
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
    const ids = payload.entries.map((e) => e.id)
    const entries = await em.find(DictionaryEntry, {
      id: { $in: ids },
      dictionary,
      organizationId: dictionary.organizationId,
      tenantId: dictionary.tenantId,
    })

    const entryMap = new Map<string, InstanceType<typeof DictionaryEntry>>()
    for (const entry of entries) {
      entryMap.set(entry.id, entry)
    }

    for (const { id, position } of payload.entries) {
      const entry = entryMap.get(id)
      if (!entry) continue
      entry.position = position
      entry.updatedAt = new Date()
    }

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
    console.error('[dictionaries/:id/entries/reorder.POST] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to reorder dictionary entries' }, { status: 500 })
  }
}

const reorderPostDoc: OpenApiMethodDoc = {
  summary: 'Reorder dictionary entries',
  description: 'Updates the position of dictionary entries for drag-and-drop reordering.',
  tags: [dictionariesTag],
  requestBody: {
    contentType: 'application/json',
    schema: reorderEntriesRequestSchema,
    description: 'Array of entry IDs with their new positions.',
  },
  responses: [
    { status: 200, description: 'Entries reordered.', schema: dictionariesOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: dictionariesErrorSchema },
    { status: 401, description: 'Authentication required', schema: dictionariesErrorSchema },
    { status: 404, description: 'Dictionary not found', schema: dictionariesErrorSchema },
    { status: 500, description: 'Failed to reorder entries', schema: dictionariesErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dictionariesTag,
  summary: 'Reorder dictionary entries',
  pathParams: dictionaryIdParamsSchema,
  methods: {
    POST: reorderPostDoc,
  },
}
