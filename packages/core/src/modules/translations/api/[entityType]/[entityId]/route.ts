import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sql } from 'kysely'
import { resolveTranslationsRouteContext, requireTranslationFeatures, resolveTranslationsActorId } from '@open-mercato/core/modules/translations/api/context'
import { translationBodySchema, entityTypeParamSchema, entityIdParamSchema } from '@open-mercato/core/modules/translations/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('translations').child({ component: 'entity-translations' })

const TRANSLATION_RESOURCE_KIND = 'translations.translation'

/**
 * Load the existing translation row's primary key + `updated_at` (the row's own
 * version), scoped to tenant/org. Returns `null` when no row exists yet.
 *
 * Optimistic locking enforces against the TRANSLATION ROW'S OWN version, not the
 * host entity's: the host's EAV `entityType` (`module:entity`) cannot be cleanly
 * mapped to a registered optimistic-lock reader key (those are derived from the
 * host module's ORM entity name / events config, e.g. `CatalogProduct` →
 * `catalog.product`, which does not equal `canonicalizeResourceTag('catalog:catalog_product')`),
 * so there is no reliable server-side path to resolve the host's current version
 * for an arbitrary `entityType`. Guarding the translation row's own `updated_at`
 * closes the no-lock hole with real server-side enforcement and no cross-module
 * coupling (mirrors the hand-written `auth.role_acl` route).
 */
async function loadTranslationRowVersion(
  db: any,
  entityType: string,
  entityId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<{ id: string; updatedAt: Date | string | null } | null> {
  const row = await db
    .selectFrom('entity_translations')
    .select(['id', 'updated_at'])
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
    .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
    .executeTakeFirst() as { id: string; updated_at: Date | string | null } | undefined
  if (!row) return null
  return { id: row.id, updatedAt: row.updated_at ?? null }
}

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

    const row = await (context.db as any)
      .selectFrom('entity_translations')
      .selectAll()
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .where(sql<boolean>`tenant_id is not distinct from ${context.tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${context.organizationId}`)
      .executeTakeFirst() as Record<string, any> | undefined

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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to load translations', { err })
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

    const rawText = await req.text()
    let rawBody: unknown = {}
    if (rawText.trim().length > 0) {
      try {
        rawBody = JSON.parse(rawText)
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }
    const translations = translationBodySchema.parse(rawBody)

    const guardUserId = resolveTranslationsActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'translations.translation',
      resourceId: `${entityType}:${entityId}`,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { entityType, entityId, translations },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    // Optimistic lock: refuse a stale standalone PUT so a translation save that
    // started from an out-of-date view cannot silently clobber a concurrent edit.
    // Strictly additive — no expected-version header → no-op. Skipped when no row
    // exists yet (first save has no prior version to conflict with).
    const existingVersion = await loadTranslationRowVersion(
      context.db as any,
      entityType,
      entityId,
      context.tenantId,
      context.organizationId,
    )
    if (existingVersion) {
      await enforceCommandOptimisticLockWithGuards(context.container, {
        resourceKind: TRANSLATION_RESOURCE_KIND,
        resourceId: existingVersion.id,
        current: existingVersion.updatedAt,
        request: req,
      })
    }

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

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const row = await (context.db as any)
      .selectFrom('entity_translations')
      .selectAll()
      .where('id', '=', result.rowId)
      .executeTakeFirst() as Record<string, any>

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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to save translations', { err })
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

    const guardUserId = resolveTranslationsActorId(context.auth)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'translations.translation',
      resourceId: `${entityType}:${entityId}`,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: null,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    // Optimistic lock: refuse a stale standalone DELETE (same hole as PUT).
    // Additive — no header → no-op; skipped when no row exists.
    const existingVersion = await loadTranslationRowVersion(
      context.db as any,
      entityType,
      entityId,
      context.tenantId,
      context.organizationId,
    )
    if (existingVersion) {
      await enforceCommandOptimisticLockWithGuards(context.container, {
        resourceKind: TRANSLATION_RESOURCE_KIND,
        resourceId: existingVersion.id,
        current: existingVersion.updatedAt,
        request: req,
      })
    }

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

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'translations.translation',
        resourceId: `${entityType}:${entityId}`,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 })
    }
    logger.error('Failed to delete translations', { err })
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
