import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext, requireTranslationFeatures } from '@open-mercato/core/modules/translations/api/context'
import { translationBodySchema, entityTypeParamSchema, entityIdParamSchema } from '@open-mercato/core/modules/translations/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const paramsSchema = z.object({
  entityType: entityTypeParamSchema,
  entityId: entityIdParamSchema,
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['translations.view'] },
  PUT: { requireAuth: true, requireFeatures: ['translations.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['translations.manage'] },
}

export async function GET(req: Request, ctx: { params?: { entityType?: string; entityId?: string } }) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    await requireTranslationFeatures(context, ['translations.view'])
    const { entityType, entityId } = paramsSchema.parse({
      entityType: ctx.params?.entityType,
      entityId: ctx.params?.entityId,
    })

    const row = await context.knex('entity_translations')
      .where({
        entity_type: entityType,
        entity_id: entityId,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [context.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [context.organizationId])
      .first()

    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      entityType: row.entity_type,
      entityId: row.entity_id,
      translations: row.translations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 })
    }
    console.error('[translations/:entityType/:entityId.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params?: { entityType?: string; entityId?: string } }) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    await requireTranslationFeatures(context, ['translations.manage'])
    const { entityType, entityId } = paramsSchema.parse({
      entityType: ctx.params?.entityType,
      entityId: ctx.params?.entityId,
    })

    const rawBody = await req.json().catch(() => ({}))
    const translations = translationBodySchema.parse(rawBody)

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      { entityType: string; entityId: string; translations: typeof translations; organizationId: string | null; tenantId: string },
      { rowId: string }
    >('translations.translation.save', {
      input: {
        entityType,
        entityId,
        translations,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
      },
      ctx: context.commandCtx,
    })

    const row = await context.knex('entity_translations')
      .where({ id: result.rowId })
      .first()

    const response = NextResponse.json({
      entityType: row.entity_type,
      entityId: row.entity_id,
      translations: row.translations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })

    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'translations.translation',
          resourceId: logEntry.resourceId ?? result.rowId,
          executedAt: logEntry.createdAt instanceof Date
            ? logEntry.createdAt.toISOString()
            : typeof logEntry.createdAt === 'string'
              ? logEntry.createdAt
              : new Date().toISOString(),
        }),
      )
    }

    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('[translations/:entityType/:entityId.PUT] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { entityType?: string; entityId?: string } }) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    await requireTranslationFeatures(context, ['translations.manage'])
    const { entityType, entityId } = paramsSchema.parse({
      entityType: ctx.params?.entityType,
      entityId: ctx.params?.entityId,
    })

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<
      { entityType: string; entityId: string; organizationId: string | null; tenantId: string },
      { deleted: boolean }
    >('translations.translation.delete', {
      input: {
        entityType,
        entityId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
      },
      ctx: context.commandCtx,
    })

    const response = new NextResponse(null, { status: 204 })

    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'translations.translation',
          resourceId: logEntry.resourceId ?? null,
          executedAt: logEntry.createdAt instanceof Date
            ? logEntry.createdAt.toISOString()
            : typeof logEntry.createdAt === 'string'
              ? logEntry.createdAt
              : new Date().toISOString(),
        }),
      )
    }

    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 })
    }
    console.error('[translations/:entityType/:entityId.DELETE] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const translationsTag = 'Translations'

const getDoc: OpenApiMethodDoc = {
  summary: 'Get entity translations',
  description: 'Returns the full translation record for a single entity.',
  tags: [translationsTag],
  responses: [
    { status: 200, description: 'Translation record found.' },
  ],
  errors: [
    { status: 401, description: 'Authentication required' },
    { status: 404, description: 'No translations found for this entity' },
  ],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Create or update entity translations',
  description: 'Full replacement of translations JSONB for an entity.',
  tags: [translationsTag],
  responses: [
    { status: 200, description: 'Translations saved.' },
  ],
  errors: [
    { status: 400, description: 'Validation failed' },
    { status: 401, description: 'Authentication required' },
  ],
}

const deleteDoc: OpenApiMethodDoc = {
  summary: 'Delete entity translations',
  description: 'Removes all translations for an entity.',
  tags: [translationsTag],
  responses: [
    { status: 204, description: 'Translations deleted.' },
  ],
  errors: [
    { status: 401, description: 'Authentication required' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: translationsTag,
  summary: 'Entity translation resource',
  pathParams: paramsSchema,
  methods: {
    GET: getDoc,
    PUT: putDoc,
    DELETE: deleteDoc,
  },
}
