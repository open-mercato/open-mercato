import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  CATALOG_SETTINGS_MODULE_ID,
  OMNIBUS_CONFIG_KEY,
  UNIT_PRICE_DISPLAY_ENABLED_DEFAULT,
  UNIT_PRICE_DISPLAY_ENABLED_KEY,
} from '../../lib/settings'
import { omnibusConfigSchema, type OmnibusConfig } from '../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

const CATALOG_SETTINGS_VIEW_FEATURE = 'catalog.settings.view'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

const bodySchema = z
  .object({
    unitPriceDisplayEnabled: z.boolean().optional(),
    omnibus: omnibusConfigSchema.optional(),
  })
  .refine((value) => value.unitPriceDisplayEnabled !== undefined || value.omnibus !== undefined, {
    message: 'Provide at least one of unitPriceDisplayEnabled or omnibus.',
    path: ['unitPriceDisplayEnabled'],
  })

const responseSchema = z.object({
  unitPriceDisplayEnabled: z.boolean(),
  omnibus: omnibusConfigSchema.optional(),
})

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  tenantId: string
  organizationId: string | null
  actorId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const actorId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0 && auth.keyId) ||
    'system'
  return {
    container,
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    actorId,
  }
}

async function readUnitPriceDisplayEnabled(context: SettingsContext): Promise<boolean> {
  const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
  const value = await configService.getValue<boolean>(
    CATALOG_SETTINGS_MODULE_ID,
    UNIT_PRICE_DISPLAY_ENABLED_KEY,
    { defaultValue: UNIT_PRICE_DISPLAY_ENABLED_DEFAULT, scope: { tenantId: context.tenantId } },
  )
  return typeof value === 'boolean' ? value : UNIT_PRICE_DISPLAY_ENABLED_DEFAULT
}

async function readOmnibusConfig(context: SettingsContext): Promise<OmnibusConfig> {
  const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
  const value = await configService.getValue<OmnibusConfig>(
    CATALOG_SETTINGS_MODULE_ID,
    OMNIBUS_CONFIG_KEY,
    { defaultValue: {}, scope: { tenantId: context.tenantId } },
  )
  return value && typeof value === 'object' ? value : {}
}

type RbacFeatureChecker = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

// The realm service is the only persistence-aware authorization entrypoint: it orders
// disabled/nulled features ahead of super-admin and wildcard grants. Reimplementing that
// ordering here would silently grant a feature the tenant has switched off.
async function canViewOmnibusConfig(context: SettingsContext): Promise<boolean> {
  try {
    const rbac = context.container.resolve('rbacService') as RbacFeatureChecker | undefined
    if (!rbac?.userHasAllFeatures) return false
    return await rbac.userHasAllFeatures(context.actorId, [CATALOG_SETTINGS_VIEW_FEATURE], {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
  } catch (err) {
    logger.warn('catalog.settings Unable to authorize the omnibus config block', { err })
    return false
  }
}

function mergeOmnibusConfig(stored: OmnibusConfig, incoming: OmnibusConfig): OmnibusConfig {
  // `backfillCoverage` is written by the backfill job, not by the settings form, so an
  // incoming config that omits it must not erase the recorded coverage (that would make the
  // 422 enable-gate permanently unsatisfiable). Every other key is caller-owned.
  return {
    ...stored,
    ...incoming,
    backfillCoverage: { ...(stored.backfillCoverage ?? {}), ...(incoming.backfillCoverage ?? {}) },
  }
}

function collectInScopeChannelIds(config: OmnibusConfig): string[] {
  const countryCodes = new Set((config.enabledCountryCodes ?? []).map((code) => code.toUpperCase()))
  if (countryCodes.size === 0) return []
  return Object.entries(config.channels ?? {})
    .filter(([, channel]) => {
      const countryCode = channel.countryCode
      return typeof countryCode === 'string' && countryCodes.has(countryCode.toUpperCase())
    })
    .map(([channelId]) => channelId)
}

function findChannelsWithoutPresentedPriceKind(config: OmnibusConfig, channelIds: string[]): string[] {
  if (config.defaultPresentedPriceKindId) return []
  const channels = config.channels ?? {}
  return channelIds.filter((channelId) => !channels[channelId]?.presentedPriceKindId)
}

function findChannelsWithoutBackfillCoverage(config: OmnibusConfig, channelIds: string[]): string[] {
  const coverage = config.backfillCoverage ?? {}
  // An unscoped backfill (key '') covers every channel.
  if (coverage['']) return []
  return channelIds.filter((channelId) => !coverage[channelId])
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const unitPriceDisplayEnabled = await readUnitPriceDisplayEnabled(context)
    if (!(await canViewOmnibusConfig(context))) {
      return NextResponse.json({ unitPriceDisplayEnabled })
    }
    const omnibus = await readOmnibusConfig(context)
    return NextResponse.json({ unitPriceDisplayEnabled, omnibus })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.settings.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const body = bodySchema.parse(await req.json())
    const resourceId = body.omnibus !== undefined ? OMNIBUS_CONFIG_KEY : UNIT_PRICE_DISPLAY_ENABLED_KEY

    const storedOmnibus = await readOmnibusConfig(context)
    const mergedOmnibus = body.omnibus !== undefined ? mergeOmnibusConfig(storedOmnibus, body.omnibus) : storedOmnibus

    // A role holding `manage` but not `view` could otherwise write an omnibus config it can
    // never read back. The write needs at least as much authority as the read.
    if (body.omnibus !== undefined && !(await canViewOmnibusConfig(context))) {
      return NextResponse.json(
        { error: 'Forbidden', details: { field: 'omnibus', error: 'catalog_settings_view_required' } },
        { status: 403 },
      )
    }

    if (body.omnibus !== undefined && mergedOmnibus.enabled === true) {
      const inScopeChannelIds = collectInScopeChannelIds(mergedOmnibus)
      const channelsWithoutPriceKind = findChannelsWithoutPresentedPriceKind(mergedOmnibus, inScopeChannelIds)
      if (channelsWithoutPriceKind.length > 0) {
        return NextResponse.json(
          {
            error: 'Invalid request',
            details: {
              field: 'omnibus.defaultPresentedPriceKindId',
              error: 'presented_price_kind_required',
              channels: channelsWithoutPriceKind,
            },
          },
          { status: 400 },
        )
      }
      const channelsWithoutCoverage = findChannelsWithoutBackfillCoverage(mergedOmnibus, inScopeChannelIds)
      if (channelsWithoutCoverage.length > 0) {
        return NextResponse.json(
          {
            field: 'omnibus.enabled',
            error: 'backfill_required_before_enable',
            channels: channelsWithoutCoverage,
          },
          { status: 422 },
        )
      }
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: 'catalog.settings',
      resourceId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { ...body },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    if (body.unitPriceDisplayEnabled !== undefined) {
      await configService.setValue(
        CATALOG_SETTINGS_MODULE_ID,
        UNIT_PRICE_DISPLAY_ENABLED_KEY,
        body.unitPriceDisplayEnabled,
        { tenantId: context.tenantId },
      )
    }
    if (body.omnibus !== undefined) {
      await configService.setValue(CATALOG_SETTINGS_MODULE_ID, OMNIBUS_CONFIG_KEY, mergedOmnibus, {
        tenantId: context.tenantId,
      })
    }

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: 'catalog.settings',
        resourceId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const unitPriceDisplayEnabled =
      body.unitPriceDisplayEnabled !== undefined
        ? body.unitPriceDisplayEnabled
        : await readUnitPriceDisplayEnabled(context)

    return NextResponse.json({ unitPriceDisplayEnabled, omnibus: mergedOmnibus })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.issues }, { status: 400 })
    }
    logger.error('catalog.settings.PUT Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Read catalog settings',
  description:
    'Returns the tenant-scoped catalog settings. The `omnibus` block (EU 2019/2161 configuration) is included only for callers holding `catalog.settings.view`; otherwise the key is omitted. It resolves to `{}` when omnibus has never been configured.',
  tags: ['Catalog'],
  responses: [
    { status: 200, description: 'Catalog settings', schema: responseSchema },
  ],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Update catalog settings',
  description:
    'Updates catalog settings. `unitPriceDisplayEnabled` and `omnibus` are independently optional and stored under separate config keys, so sending one leaves the other untouched; an empty body is rejected with 400. Enabling omnibus (`omnibus.enabled = true`) requires a resolvable presented price kind for every in-scope EU channel and recorded backfill coverage for each of them.',
  tags: ['Catalog'],
  requestBody: { schema: bodySchema },
  responses: [
    { status: 200, description: 'Updated catalog settings', schema: responseSchema },
  ],
  errors: [
    {
      status: 400,
      description:
        'Invalid or empty request body, or an enabled omnibus config leaving an in-scope EU channel without a presented price kind',
    },
    {
      status: 422,
      description:
        'Omnibus enable blocked because an in-scope EU channel has no recorded backfill coverage; nothing is persisted',
    },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog module settings',
  methods: {
    GET: getDoc,
    PUT: putDoc,
  },
}

export { GET, PUT }
