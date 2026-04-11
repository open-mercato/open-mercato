import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { EntityManager } from '@mikro-orm/postgresql'
import { omnibusConfigSchema } from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY } from '../../../lib/omnibus'
import type { CatalogOmnibusService } from '../../../services/catalogOmnibusService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.settings.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['catalog.settings.edit'] },
}

export async function GET(req: NextRequest) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')
    const value = await moduleConfigService.getValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, { defaultValue: {}, context: { organizationId: auth.orgId } })
    return NextResponse.json(value ?? {})
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export async function PATCH(req: NextRequest) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parseResult = omnibusConfigSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid config', details: parseResult.error.flatten() }, { status: 400 })
    }
    const parsed = parseResult.data

    const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')
    const orgContext = { organizationId: auth.orgId }

    const existing = (await moduleConfigService.getValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, { defaultValue: {}, context: orgContext })) ?? {}

    const enabledCountryCodes = parsed.enabledCountryCodes ?? (existing as Record<string, unknown>).enabledCountryCodes ?? []
    const channels = parsed.channels ?? (existing as Record<string, unknown>).channels ?? {}
    const existingBackfillCoverage = (existing as Record<string, unknown>).backfillCoverage ?? {}
    const parsedBackfillCoverage = parsed.backfillCoverage ?? {}

    const channelsNeedingBackfill = parsed.enabled === true
      ? Object.entries(channels as Record<string, { countryCode?: string }>)
          .filter(([, cfg]) => cfg.countryCode && (enabledCountryCodes as string[]).includes(cfg.countryCode as string))
          .filter(([id]) => !(existingBackfillCoverage as Record<string, unknown>)[id])
          .map(([id]) => id)
      : []

    let backfillCoverage = { ...(existingBackfillCoverage as Record<string, unknown>), ...parsedBackfillCoverage }

    if (channelsNeedingBackfill.length > 0) {
      const omnibusService = container.resolve<CatalogOmnibusService>('catalogOmnibusService')
      const em = container.resolve<EntityManager>('em')
      const lookbackDays = (parsed.lookbackDays ?? (existing as Record<string, unknown>).lookbackDays ?? 30) as number
      for (const channelId of channelsNeedingBackfill) {
        await omnibusService.backfillChannel(em, {
          organizationId: auth.orgId,
          tenantId: auth.tenantId,
          channelId,
          lookbackDays,
        })
        backfillCoverage[channelId] = { completedAt: new Date().toISOString(), lookbackDays }
      }
    }

    const merged = { ...(existing as Record<string, unknown>), ...parsed, backfillCoverage }
    await moduleConfigService.setValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, merged, orgContext)
    return NextResponse.json(merged)
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Catalog'],
      summary: 'Get Omnibus configuration',
      description: 'Returns the current Omnibus compliance configuration for the organization.',
      responses: [
        { status: 200, description: 'Omnibus config object' },
      ],
    },
    PATCH: {
      tags: ['Catalog'],
      summary: 'Update Omnibus configuration',
      description: 'Updates the Omnibus compliance configuration. Validates that backfill has been completed before enabling.',
      responses: [
        { status: 200, description: 'Updated config' },
        { status: 422, description: 'Validation error (e.g. backfill_required_before_enable)' },
      ],
    },
  },
}
