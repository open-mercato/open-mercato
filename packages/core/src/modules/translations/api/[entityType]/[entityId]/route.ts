import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { translationBodySchema, entityTypeParamSchema, entityIdParamSchema } from '@open-mercato/core/modules/translations/data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
    const { entityType, entityId } = paramsSchema.parse({
      entityType: ctx.params?.entityType,
      entityId: ctx.params?.entityId,
    })

    const rawBody = await req.json().catch(() => ({}))
    const translations = translationBodySchema.parse(rawBody)

    const existing = await context.knex('entity_translations')
      .where({
        entity_type: entityType,
        entity_id: entityId,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [context.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [context.organizationId])
      .first()

    const now = context.knex.fn.now()

    if (existing) {
      await context.knex('entity_translations')
        .where({ id: existing.id })
        .update({
          translations,
          updated_at: now,
        })
    } else {
      await context.knex('entity_translations').insert({
        entity_type: entityType,
        entity_id: entityId,
        organization_id: context.organizationId,
        tenant_id: context.tenantId,
        translations,
        created_at: now,
        updated_at: now,
      })
    }

    try {
      const bus = context.container.resolve<{ emitEvent: (event: string, payload: unknown) => Promise<void> }>('eventBus')
      await bus.emitEvent('translations.translation.updated', {
        entityType,
        entityId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
      })
    } catch (err) {
      console.warn('[translations] Failed to emit translations.translation.updated:', err instanceof Error ? err.message : 'unknown')
    }

    const row = await context.knex('entity_translations')
      .where({
        entity_type: entityType,
        entity_id: entityId,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [context.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [context.organizationId])
      .first()

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
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('[translations/:entityType/:entityId.PUT] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { entityType?: string; entityId?: string } }) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    const { entityType, entityId } = paramsSchema.parse({
      entityType: ctx.params?.entityType,
      entityId: ctx.params?.entityId,
    })

    await context.knex('entity_translations')
      .where({
        entity_type: entityType,
        entity_id: entityId,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [context.tenantId])
      .andWhereRaw('organization_id is not distinct from ?', [context.organizationId])
      .del()

    try {
      const bus = context.container.resolve<{ emitEvent: (event: string, payload: unknown) => Promise<void> }>('eventBus')
      await bus.emitEvent('translations.translation.deleted', {
        entityType,
        entityId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
      })
    } catch (err) {
      console.warn('[translations] Failed to emit translations.translation.deleted:', err instanceof Error ? err.message : 'unknown')
    }

    return new NextResponse(null, { status: 204 })
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
