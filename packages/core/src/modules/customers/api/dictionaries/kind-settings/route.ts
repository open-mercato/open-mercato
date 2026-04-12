import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TableNotFoundException } from '@mikro-orm/core'
import { CustomerDictionaryKindSetting } from '../../../data/entities'
import { resolveDictionaryRouteContext } from '../context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
})

function isMissingKindSettingsTable(error: unknown): boolean {
  if (error instanceof TableNotFoundException) {
    return true
  }
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string'
      && candidate.message.includes('customer_dictionary_kind_settings')
      && candidate.message.includes('does not exist'))
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse({
      organizationId: url.searchParams.get('organizationId') ?? undefined,
    })
    const context = await resolveDictionaryRouteContext(req, {
      selectedId: query.organizationId ?? undefined,
    })
    const em = context.em

    const settings = await findWithDecryption(
      em,
      CustomerDictionaryKindSetting,
      {
        tenantId: context.tenantId,
        ...(context.organizationId ? { organizationId: context.organizationId } : {}),
      },
      { orderBy: { sortOrder: 'asc', kind: 'asc' } },
      { tenantId: context.tenantId, organizationId: context.organizationId ?? null },
    )

    return NextResponse.json({
      items: settings.map((s) => ({
        id: s.id,
        kind: s.kind,
        selectionMode: s.selectionMode,
        visibleInTags: s.visibleInTags,
        sortOrder: s.sortOrder,
      })),
    })
  } catch (err) {
    if (isMissingKindSettingsTable(err)) {
      return NextResponse.json({ items: [] })
    }
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/dictionaries/kind-settings.GET]', err)
    return NextResponse.json({ error: 'Failed to load kind settings' }, { status: 500 })
  }
}

const patchSchema = z.object({
  kind: z.string().trim().min(1).max(100),
  selectionMode: z.enum(['single', 'multi']).optional(),
  visibleInTags: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export async function PATCH(req: Request) {
  try {
    const context = await resolveDictionaryRouteContext(req)
    if (!context.organizationId) {
      throw new CrudHttpError(400, { error: 'Organization context is required' })
    }
    const payload = patchSchema.parse(await readJsonSafe(req, {}))
    const guardUserId = resolveAuthActorId(context.auth!)
    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: guardUserId,
      resourceKind: 'customers.settings',
      resourceId: context.organizationId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const em = (context.em as EntityManager).fork()
    let setting = await findOneWithDecryption(em, CustomerDictionaryKindSetting, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: payload.kind,
    }, {}, { tenantId: context.tenantId, organizationId: context.organizationId })

    if (!setting) {
      setting = em.create(CustomerDictionaryKindSetting, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        kind: payload.kind,
        selectionMode: payload.selectionMode ?? 'single',
        visibleInTags: payload.visibleInTags ?? true,
        sortOrder: payload.sortOrder ?? 0,
      })
      em.persist(setting)
    } else {
      if (payload.selectionMode !== undefined) setting.selectionMode = payload.selectionMode
      if (payload.visibleInTags !== undefined) setting.visibleInTags = payload.visibleInTags
      if (payload.sortOrder !== undefined) setting.sortOrder = payload.sortOrder
    }

    await em.flush()

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: guardUserId,
        resourceKind: 'customers.settings',
        resourceId: context.organizationId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      id: setting.id,
      kind: setting.kind,
      selectionMode: setting.selectionMode,
      visibleInTags: setting.visibleInTags,
      sortOrder: setting.sortOrder,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/dictionaries/kind-settings.PATCH]', err)
    return NextResponse.json({ error: 'Failed to update kind setting' }, { status: 500 })
  }
}

const kindSettingSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  selectionMode: z.enum(['single', 'multi']),
  visibleInTags: z.boolean(),
  sortOrder: z.number(),
})

const kindSettingsListSchema = z.object({
  items: z.array(kindSettingSchema),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer dictionary kind settings',
  methods: {
    GET: {
      summary: 'List kind settings',
      description: 'Returns selection mode and visibility settings for each dictionary kind.',
      responses: [
        { status: 200, description: 'Kind settings', schema: kindSettingsListSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    PATCH: {
      summary: 'Update kind setting',
      description: 'Creates or updates settings for a specific dictionary kind.',
      requestBody: { contentType: 'application/json', schema: patchSchema },
      responses: [
        { status: 200, description: 'Setting updated', schema: kindSettingSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
