import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { customerSettingsUpsertSchema, type CustomerSettingsUpsertInput } from '../../../data/validators'
import { loadCustomerSettings } from '../../../commands/settings'
import type { CustomerAddressFormat } from '../../../data/entities'
import { withScopedPayload } from '../../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
  em: EntityManager
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const em = container.resolve<EntityManager>('em')
  return {
    ctx,
    tenantId: auth.tenantId,
    organizationId,
    translate,
    em,
  }
}

export async function GET(req: Request) {
  try {
    const { em, tenantId, organizationId } = await resolveSettingsContext(req)
    const record = await loadCustomerSettings(em, { tenantId, organizationId })
    return NextResponse.json({
      addressFormat: record?.addressFormat ?? 'line_first',
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.settings.address-format.get failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to load settings') }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate } = await resolveSettingsContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = customerSettingsUpsertSchema.parse(scoped)

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<CustomerSettingsUpsertInput, { settingsId: string; addressFormat: CustomerAddressFormat }>(
      'customers.settings.save',
      { input, ctx },
    )

    return NextResponse.json({
      addressFormat: result?.addressFormat ?? input.addressFormat,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.settings.address-format.put failed', err)
    return NextResponse.json({ error: translate('customers.errors.save_failed', 'Failed to save settings') }, { status: 400 })
  }
}

const addressFormatResponseSchema = z.object({
  addressFormat: z.string(),
})

const addressFormatErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer address format settings',
  methods: {
    GET: {
      summary: 'Retrieve address format',
      description: 'Returns the current address formatting preference for the selected organization.',
      responses: [
        { status: 200, description: 'Current address format', schema: addressFormatResponseSchema },
        { status: 401, description: 'Unauthorized', schema: addressFormatErrorSchema },
        { status: 400, description: 'Organization context missing', schema: addressFormatErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update address format',
      description: 'Updates the address format preference for the selected organization.',
      requestBody: {
        contentType: 'application/json',
        schema: customerSettingsUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Updated address format', schema: addressFormatResponseSchema },
        { status: 401, description: 'Unauthorized', schema: addressFormatErrorSchema },
        { status: 400, description: 'Invalid payload or organization context', schema: addressFormatErrorSchema },
      ],
    },
  },
}
