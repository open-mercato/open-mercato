import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SAUDI_FILING_FREQUENCIES, saudiVatSettingsInputSchema } from '../../data/validators'
import {
  SAUDI_VAT_SETTINGS_KEY,
  isSaudiVatSettingsComplete,
  readSaudiVatSettingsRecord,
  writeSaudiVatSettings,
  type SaudiVatSettingsRecord,
  type SaudiVatSettingsScope,
} from '../../lib/vat-settings'

const logger = createLogger('saudi_localization')

export const metadata = {
  path: '/saudi_localization/vat-settings',
  GET: { requireAuth: true, requireFeatures: ['saudi_localization.settings.view'] },
  PUT: { requireAuth: true, requireFeatures: ['saudi_localization.settings.manage'] },
}

const SETTINGS_RESOURCE_KIND = 'saudi_localization.settings'
const MANAGE_FEATURE = 'saudi_localization.settings.manage'

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string | null
  actorId: string
  scope: SaudiVatSettingsScope
  /**
   * Whether the caller may write. The screen is reachable with `settings.view`
   * alone, so it has to be told which of the two states it is in: reporting it
   * here keeps the read-only rendering authoritative (the permission is decided
   * by the same RBAC service the PUT guard uses, in the caller's own
   * organization scope) instead of the browser guessing from a nav entry.
   */
  canManage: boolean
}

async function resolveSettingsContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }

  const actorId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0 && auth.keyId) ||
    'system'
  const organizationId = auth.orgId ?? null

  const rbac = container.resolve<RbacService>('rbacService')
  const featureContext = await resolveFeatureCheckContext({ container, auth, request: req })
  const canManage = await rbac.userHasAllFeatures(auth.sub, [MANAGE_FEATURE], {
    tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
    organizationId: featureContext.organizationId,
  })

  return {
    container,
    tenantId: auth.tenantId,
    organizationId,
    actorId,
    canManage,
    // Tenant-scoped: the VAT number belongs to the legal entity the tenant
    // invoices from. The platform falls back to the instance-global row, so a
    // tenant that configured nothing still reads the shipped defaults.
    scope: { tenantId: auth.tenantId, organizationId },
  }
}

function configService(context: SettingsContext): ModuleConfigService {
  return context.container.resolve('moduleConfigService') as ModuleConfigService
}

function toResponse(record: SaudiVatSettingsRecord, canManage: boolean) {
  return {
    ...record.settings,
    isComplete: isSaudiVatSettingsComplete(record.settings),
    canManage,
    updatedAt: record.updatedAt,
  }
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const record = await readSaudiVatSettingsRecord(configService(context), context.scope)
    return NextResponse.json(toResponse(record, context.canManage))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('saudi_localization.vat_settings.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const raw = await readJsonSafe(req, null)
    const input = saudiVatSettingsInputSchema.parse(raw ?? {})

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: SETTINGS_RESOURCE_KIND,
      resourceId: SAUDI_VAT_SETTINGS_KEY,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const existing = await readSaudiVatSettingsRecord(configService(context), context.scope)
    // Refuse a stale overwrite when two tabs edit the same VAT identity: the
    // expected version travels in the extension header the same way it does for
    // every CRUD entity. Strictly additive — a no-op without the header.
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: SETTINGS_RESOURCE_KIND,
      resourceId: SAUDI_VAT_SETTINGS_KEY,
      current: existing.updatedAt,
      request: req,
    })

    const record = await writeSaudiVatSettings(configService(context), input, context.scope)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: SETTINGS_RESOURCE_KIND,
        resourceId: SAUDI_VAT_SETTINGS_KEY,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    // A completed write proves `settings.manage`, so the response keeps the
    // same shape as the read without a second RBAC lookup.
    return NextResponse.json(toResponse(record, true))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        {
          error: translate('saudi_localization.errors.invalid_vat_settings', 'Invalid Saudi VAT settings'),
          details: err.issues,
        },
        { status: 400 },
      )
    }
    logger.error('saudi_localization.vat_settings.PUT failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const settingsResponseSchema = z.object({
  sellerName: z.string(),
  vatRegistrationNumber: z.string(),
  commercialRegistrationNumber: z.string().nullable(),
  vatRate: z.number(),
  invoiceQrEnabled: z.boolean(),
  /** ZATCA filing period the VAT return is built for. */
  filingFrequency: z.enum(SAUDI_FILING_FREQUENCIES),
  isComplete: z.boolean(),
  /** Whether the caller holds `saudi_localization.settings.manage`. */
  canManage: z.boolean(),
  /** Version to send back on the next write; `null` before the first one. */
  updatedAt: z.string().nullable(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Read the Saudi VAT settings',
  tags: ['Saudi Localization'],
  responses: [
    { status: 200, description: 'Current settings merged with the shipped defaults', schema: settingsResponseSchema },
  ],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Replace the Saudi VAT settings',
  tags: ['Saudi Localization'],
  requestBody: { schema: saudiVatSettingsInputSchema },
  responses: [{ status: 200, description: 'Stored settings', schema: settingsResponseSchema }],
  errors: [
    { status: 400, description: 'Invalid request body' },
    { status: 401, description: 'Unauthorized' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'Seller VAT identity used by the ZATCA invoice QR',
  methods: { GET: getDoc, PUT: putDoc },
}

export { GET, PUT }
