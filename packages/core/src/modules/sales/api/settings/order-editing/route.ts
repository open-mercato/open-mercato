import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { salesEditingSettingsSchema, salesSettingsUpsertSchema } from '../../../data/validators'
import { loadSalesSettings } from '../../../commands/settings'
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from '../../../lib/documentNumberTokens'
import { withScopedPayload } from '../../utils'
import { ensureSalesDictionary } from '../../../lib/dictionaries'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  translate: (key: string, fallback?: string) => string
  organizationId: string
  tenantId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.settings.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.settings.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const em = container.resolve('em') as EntityManager

  return {
    ctx,
    em,
    translate,
    tenantId: auth.tenantId,
    organizationId,
  }
}

async function loadStatusOptions(em: EntityManager, tenantId: string, organizationId: string) {
  const dictionary = await ensureSalesDictionary({
    em,
    tenantId,
    organizationId,
    kind: 'order-status',
  })
  const entries = await em.find(
    DictionaryEntry,
    {
      dictionary,
      tenantId,
      organizationId,
    },
    { orderBy: { value: 'asc' } }
  )
  return entries.map((entry) => ({
    id: entry.id,
    value: entry.value ?? '',
    label: entry.label ?? entry.value ?? '',
  }))
}

export async function GET(req: Request) {
  try {
    const { em, organizationId, tenantId } = await resolveSettingsContext(req)
    const record = await loadSalesSettings(em, { tenantId, organizationId })
    const orderStatuses = await loadStatusOptions(em, tenantId, organizationId)

    return NextResponse.json({
      orderCustomerEditableStatuses: record?.orderCustomerEditableStatuses ?? null,
      orderAddressEditableStatuses: record?.orderAddressEditableStatuses ?? null,
      orderStatuses,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.settings.order-editing.get failed', err)
    return NextResponse.json(
      { error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') },
      { status: 400 }
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate, organizationId, tenantId, em } = await resolveSettingsContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const parsed = salesEditingSettingsSchema.parse(scoped)

    const current = await loadSalesSettings(em, { tenantId, organizationId })
    const commandInput = salesSettingsUpsertSchema.parse({
      ...parsed,
      orderNumberFormat: parsed.orderNumberFormat ?? current?.orderNumberFormat ?? DEFAULT_ORDER_NUMBER_FORMAT,
      quoteNumberFormat: parsed.quoteNumberFormat ?? current?.quoteNumberFormat ?? DEFAULT_QUOTE_NUMBER_FORMAT,
      orderNextNumber: payload?.orderNextNumber,
      quoteNextNumber: payload?.quoteNextNumber,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const response = await commandBus.execute('sales.settings.save', { input: commandInput, ctx })
    const result = (response as { result?: { orderCustomerEditableStatuses?: string[] | null; orderAddressEditableStatuses?: string[] | null } }).result

    const orderStatuses = await loadStatusOptions(em, tenantId, organizationId)

    return NextResponse.json({
      orderCustomerEditableStatuses: result?.orderCustomerEditableStatuses ?? null,
      orderAddressEditableStatuses: result?.orderAddressEditableStatuses ?? null,
      orderStatuses,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.settings.order-editing.put failed', err)
    return NextResponse.json(
      { error: translate('sales.settings.errors.save_failed', 'Failed to save sales settings') },
      { status: 400 }
    )
  }
}

const orderStatusOptionSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
})

const settingsResponseSchema = z.object({
  orderCustomerEditableStatuses: z.array(z.string()).nullable(),
  orderAddressEditableStatuses: z.array(z.string()).nullable(),
  orderStatuses: z.array(orderStatusOptionSchema),
})

const settingsErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Sales order editing settings',
  methods: {
    GET: {
      summary: 'Get order editing guards',
      responses: [
        { status: 200, description: 'Current order editing guards', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Missing scope', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update order editing guards',
      requestBody: {
        contentType: 'application/json',
        schema: salesEditingSettingsSchema,
      },
      responses: [
        { status: 200, description: 'Updated order editing guards', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid payload', schema: settingsErrorSchema },
      ],
    },
  },
}
