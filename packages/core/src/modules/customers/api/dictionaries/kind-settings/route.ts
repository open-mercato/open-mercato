import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TableNotFoundException } from '@mikro-orm/core'
import { CustomerDictionaryKindSetting } from '../../../data/entities'
import { resolveDictionaryRouteContext } from '../context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  customerKindSettingsUpsertSchema,
  type CustomerKindSettingsUpsertInput,
} from '../../../data/validators'

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
  const { translate } = await resolveTranslations()
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
    return NextResponse.json({ error: translate('customers.errors.kind_settings_load_failed', 'Failed to load kind settings') }, { status: 500 })
  }
}

const patchSchema = z.object({
  kind: z.string().trim().min(1).max(100),
  selectionMode: z.enum(['single', 'multi']).optional(),
  visibleInTags: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export async function PATCH(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const context = await resolveDictionaryRouteContext(req)
    if (!context.organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
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

    const commandInput: CustomerKindSettingsUpsertInput = customerKindSettingsUpsertSchema.parse({
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      kind: payload.kind,
      selectionMode: payload.selectionMode,
      visibleInTags: payload.visibleInTags,
      sortOrder: payload.sortOrder,
    })

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      CustomerKindSettingsUpsertInput,
      {
        settingId: string
        created: boolean
        kind: string
        selectionMode: string
        visibleInTags: boolean
        sortOrder: number
      }
    >('customers.dictionaryKindSettings.upsert', {
      input: commandInput,
      ctx: context.ctx,
    })

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

    const response = NextResponse.json({
      id: result.settingId,
      kind: result.kind,
      selectionMode: result.selectionMode,
      visibleInTags: result.visibleInTags,
      sortOrder: result.sortOrder,
    })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.dictionaryKindSetting',
          resourceId: logEntry.resourceId ?? result.settingId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
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
