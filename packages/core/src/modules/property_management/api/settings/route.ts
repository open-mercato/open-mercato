import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { settingsBodySchema, settingsSaveSchema } from '../../data/validators'
import { loadSettingsRecord, settingsValuesOf } from '../../lib/settings'
import { localToday } from '../../lib/leaseTerm'
import { SETTINGS_RESOURCE_KIND } from '../../commands/settings'
import { MANAGE_ALL_BUILDINGS_FEATURE } from '../../lib/buildingAccess'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { guardedCommandInput, handleRouteError, resolveStaffContext, runStaffGuard, type StaffRouteContext } from '../routeContext'

const MANAGE_FEATURE = 'property_management.manage'
const LEASES_MANAGE_FEATURE = 'property_management.leases.manage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
  PUT: { requireAuth: true, requireFeatures: [MANAGE_FEATURE, MANAGE_ALL_BUILDINGS_FEATURE] },
}

type RbacLike = {
  userHasAllFeatures: (userId: string, features: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

async function hasFeature(context: StaffRouteContext, feature: string): Promise<boolean> {
  const auth = context.ctx.auth
  if (!auth?.sub) return false
  const rbac = context.ctx.container.resolve('rbacService') as RbacLike
  return rbac.userHasAllFeatures(auth.sub, [feature], { tenantId: context.tenantId, organizationId: context.organizationId })
}

const SETTINGS_FIELD_ERROR_FALLBACKS: Record<string, string> = {
  'property_management.errors.leaseEndingThresholdInvalid': 'Enter a whole number of days from 1 to 365.',
  'property_management.errors.bookingReminderInvalid': 'Enter a whole number of minutes from 5 to 1440.',
  'property_management.errors.proposalExpiryInvalid': 'Enter a whole number of days from 1 to 90.',
}

function translateSettingsFieldErrors(
  issues: z.ZodError['issues'],
  translate: (key: string, fallback?: string) => string,
): Record<string, string> {
  return Object.fromEntries(
    issues.map((issue) => {
      const fallback = SETTINGS_FIELD_ERROR_FALLBACKS[issue.message]
      const message = fallback ? translate(issue.message, fallback) : translate('property_management.errors.invalidInput', 'Invalid input')
      return [String(issue.path[0] ?? 'form'), message]
    }),
  )
}

async function readSettings(context: StaffRouteContext, canEdit: boolean) {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const record = await loadSettingsRecord(context.em.fork(), scope)
  const values = settingsValuesOf(record)
  return {
    id: record?.id ?? null,
    ...values,
    billingChannelConfigured: Boolean(values.billingChannelId),
    canEdit,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
    today: localToday(),
  }
}

async function readLeaseSettings(context: StaffRouteContext) {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const values = settingsValuesOf(await loadSettingsRecord(context.em.fork(), scope))
  return {
    readOnly: true as const,
    proposalExpiryDays: values.proposalExpiryDays,
    billingChannelConfigured: Boolean(values.billingChannelId),
    today: localToday(),
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    if (await hasFeature(context, MANAGE_FEATURE)) {
      return NextResponse.json(await readSettings(context, await hasFeature(context, MANAGE_ALL_BUILDINGS_FEATURE)))
    }
    if (await hasFeature(context, LEASES_MANAGE_FEATURE)) return NextResponse.json(await readLeaseSettings(context))
    throw new CrudHttpError(403, { error: context.translate('property_management.errors.forbidden', 'You do not have permission to do this.') })
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
    const commandInput = guardedCommandInput(settingsSaveSchema, guarded, input, { tenantId: context.tenantId, organizationId: context.organizationId })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('property_management.settings.save', { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json(await readSettings(context, true))
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      const fieldErrors = translateSettingsFieldErrors(err.issues, translate)
      return NextResponse.json({ error: translate('property_management.errors.invalidInput', 'Invalid input'), fieldErrors }, { status: 422 })
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
  billingChannelConfigured: z.boolean(),
  canEdit: z.boolean(),
  updatedAt: z.string().nullable(),
  today: z.string(),
})

const leaseSettingsResponseSchema = z.object({
  readOnly: z.literal(true),
  proposalExpiryDays: z.number().int(),
  billingChannelConfigured: z.boolean(),
  today: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Property management settings',
  methods: {
    GET: {
      summary: 'Settings of the current organization (defaults applied)',
      description: 'Callers with property_management.manage get every setting; `canEdit` is true only when they also have property_management.buildings.manage_all, which saving requires. Callers with only property_management.leases.manage get a read-only subset: the proposal expiry default and whether a billing channel is configured. Both shapes carry `today`, the deployment’s local date (`YYYY-MM-DD`) that lease date checks use.',
      responses: [
        { status: 200, description: 'Settings', schema: z.union([settingsResponseSchema, leaseSettingsResponseSchema]) },
      ],
      errors: [{ status: 403, description: 'Neither property_management.manage nor property_management.leases.manage' }],
    },
    PUT: {
      summary: 'Save the settings of the current organization',
      description: 'Requires property_management.manage and property_management.buildings.manage_all. The sales channel and cancelled order status must belong to the organization. Optimistic lock on the row.',
      requestBody: { contentType: 'application/json', schema: settingsBodySchema },
      responses: [{ status: 200, description: 'Saved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 403, description: 'settings_forbidden: the caller does not manage every building' },
        { status: 409, description: 'The settings changed since they were loaded' },
        { status: 422, description: 'Invalid values (e.g. proposal expiry outside 1–90 days), or a channel or status entry outside this organization' },
      ],
    },
  },
}
