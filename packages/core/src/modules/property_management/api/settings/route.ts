import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { settingsBodySchema, settingsSaveSchema } from '../../data/validators'
import { loadSettingsRecord, settingsValuesOf } from '../../lib/settings'
import { SETTINGS_RESOURCE_KIND } from '../../commands/settings'
import { handleRouteError, resolveStaffContext, runStaffGuard } from '../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['property_management.manage'] },
}

async function readSettings(context: Awaited<ReturnType<typeof resolveStaffContext>>) {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const record = await loadSettingsRecord(context.em.fork(), scope)
  return {
    id: record?.id ?? null,
    ...settingsValuesOf(record),
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    return NextResponse.json(await readSettings(context))
  } catch (err) {
    return handleRouteError(err, 'property_management.settings_read_failed')
  }
}

export async function PUT(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const body = settingsBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = settingsSaveSchema.parse({ ...body, tenantId: context.tenantId, organizationId: context.organizationId })
    const guarded = await runStaffGuard(req, context, { resourceKind: SETTINGS_RESOURCE_KIND, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload ? settingsSaveSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('property_management.settings.save', { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json(await readSettings(context))
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (err instanceof z.ZodError) {
      const fieldErrors = Object.fromEntries(err.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]))
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('property_management.errors.invalidInput', 'Invalid input'), fieldErrors, issues: err.issues }, { status: 422 })
    }
    return handleRouteError(err, 'property_management.settings_save_failed')
  }
}

const settingsResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  billingChannelId: z.string().uuid().nullable(),
  cancelledOrderStatusEntryId: z.string().uuid().nullable(),
  leaseEndingThresholdDays: z.number().int(),
  bookingReminderMinutes: z.number().int(),
  proposalExpiryDays: z.number().int(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Property management settings',
  methods: {
    GET: {
      summary: 'Settings of the current organization (defaults applied)',
      responses: [{ status: 200, description: 'Settings', schema: settingsResponseSchema }],
    },
    PUT: {
      summary: 'Save the settings of the current organization',
      description: 'The sales channel and cancelled order status must belong to the organization. Optimistic lock on the row.',
      requestBody: { contentType: 'application/json', schema: settingsBodySchema },
      responses: [{ status: 200, description: 'Saved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 409, description: 'The settings changed since they were loaded' },
        { status: 422, description: 'Invalid values (e.g. proposal expiry outside 1–90 days), or a channel or status entry outside this organization' },
      ],
    },
  },
}
