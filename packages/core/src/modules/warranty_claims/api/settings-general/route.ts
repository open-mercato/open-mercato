import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  warrantyClaimSettingsSaveSchema,
  warrantyClaimSettingsUpdateSchema,
  type WarrantyClaimSettingsSaveInput,
} from '../../data/validators'
import {
  loadWarrantyClaimSettings,
  resolveEffectiveWarrantyClaimSettings,
  type WarrantyClaimEffectiveSettings,
} from '../../lib/settings'
import { WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND, type SaveWarrantyClaimSettingsResult } from '../../commands/settings'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  tenantId: string
  organizationId: string
  userId: string
  translate: (key: string, fallback?: string) => string
}

type SettingsResponseResult = WarrantyClaimEffectiveSettings & {
  updatedAt: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return {
    ctx,
    em: container.resolve('em') as EntityManager,
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub ?? '',
    translate,
  }
}

async function buildSettingsResult(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<SettingsResponseResult> {
  const record = await loadWarrantyClaimSettings(em, scope)
  const effectiveSettings = await resolveEffectiveWarrantyClaimSettings(em, scope)
  return {
    ...effectiveSettings,
    updatedAt: toIso(record?.updatedAt),
  }
}

export async function GET(req: Request) {
  try {
    const { em, tenantId, organizationId } = await resolveSettingsContext(req)
    const result = await buildSettingsResult(em, { tenantId, organizationId })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    logger.error('warranty_claims.settings-general.get failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data.') }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, em, tenantId, organizationId, userId, translate } = await resolveSettingsContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const parsed = warrantyClaimSettingsUpdateSchema.parse(payload)
    const parsedPayload: Record<string, unknown> = { ...parsed }
    const existing = await loadWarrantyClaimSettings(em, { tenantId, organizationId })
    const guarded = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: { userId, tenantId, organizationId },
      input: {
        resourceKind: WARRANTY_CLAIM_SETTINGS_RESOURCE_KIND,
        resourceId: existing?.id ?? null,
        operation: existing ? 'update' : 'create',
        mutationPayload: parsedPayload,
      },
    })
    if (!guarded.ok) return guarded.response

    const guardedPayload = guarded.modifiedPayload
      ? warrantyClaimSettingsUpdateSchema.parse({ ...parsedPayload, ...guarded.modifiedPayload })
      : parsed
    const commandInput = warrantyClaimSettingsSaveSchema.parse(withScopedPayload({ ...guardedPayload }, ctx, translate))
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      WarrantyClaimSettingsSaveInput,
      SaveWarrantyClaimSettingsResult
    >('warranty_claims.settings.save', { input: commandInput, ctx })

    await guarded.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      result: {
        slaHours: result.slaHours,
        slaPauseOnInfoRequested: result.slaPauseOnInfoRequested,
        slaAtRiskThresholdPct: result.slaAtRiskThresholdPct,
        autoApproveEnabled: result.autoApproveEnabled,
        autoApproveMaxAmount: result.autoApproveMaxAmount,
        autoApproveCurrencyCode: result.autoApproveCurrencyCode,
        autoApproveRequireInWarranty: result.autoApproveRequireInWarranty,
        defaultWarrantyMonths: result.defaultWarrantyMonths,
        businessHours: result.businessHours,
        escalationTiers: result.escalationTiers,
        adjudicationUseRules: result.adjudicationUseRules,
        quarantineGrades: result.quarantineGrades,
        returnLabelProvider: result.returnLabelProvider,
        updatedAt: result.updatedAt,
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.settings-general.put failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

const settingsResultSchema = z.object({
  slaHours: z.number(),
  slaPauseOnInfoRequested: z.boolean(),
  slaAtRiskThresholdPct: z.number(),
  autoApproveEnabled: z.boolean(),
  autoApproveMaxAmount: z.number().nullable(),
  autoApproveCurrencyCode: z.string().nullable(),
  autoApproveRequireInWarranty: z.boolean(),
  defaultWarrantyMonths: z.number().nullable(),
  businessHours: z.record(z.string(), z.unknown()).nullable(),
  escalationTiers: z.array(z.unknown()).nullable(),
  adjudicationUseRules: z.boolean(),
  quarantineGrades: z.array(z.string()).nullable(),
  returnLabelProvider: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const settingsResponseSchema = z.object({
  ok: z.boolean(),
  result: settingsResultSchema,
})

const settingsErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Warranty claim general settings',
  methods: {
    GET: {
      summary: 'Get warranty claim general settings',
      responses: [
        { status: 200, description: 'Current warranty claim general settings', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid scope', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update warranty claim general settings',
      requestBody: {
        contentType: 'application/json',
        schema: warrantyClaimSettingsUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Updated warranty claim general settings', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid payload', schema: settingsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: settingsErrorSchema },
      ],
    },
  },
}
