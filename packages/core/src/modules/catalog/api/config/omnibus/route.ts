import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { omnibusConfigSchema } from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY } from '../../../lib/omnibus'

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
    const value = await moduleConfigService.getValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, { defaultValue: {} })
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

    const body = await req.json()
    const parsed = omnibusConfigSchema.parse(body)

    const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')

    const existing = (await moduleConfigService.getValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, { defaultValue: {} })) ?? {}

    if (parsed.enabled === true) {
      const enabledCountryCodes = parsed.enabledCountryCodes ?? (existing as Record<string, unknown>).enabledCountryCodes ?? []
      const channels = parsed.channels ?? (existing as Record<string, unknown>).channels ?? {}
      const backfillCoverage = parsed.backfillCoverage ?? (existing as Record<string, unknown>).backfillCoverage ?? {}
      const channelsWithCountry = Object.entries(channels as Record<string, { countryCode?: string }>)
        .filter(([, cfg]) => cfg.countryCode && (enabledCountryCodes as string[]).includes(cfg.countryCode))
      const channelsNeedingBackfill = channelsWithCountry
        .filter(([id]) => !(backfillCoverage as Record<string, unknown>)[id])
        .map(([id]) => id)
      if (channelsNeedingBackfill.length > 0) {
        return NextResponse.json(
          {
            error: 'backfill_required_before_enable',
            field: 'enabled',
            channels: channelsNeedingBackfill,
            message: 'Run `yarn omnibus:backfill --channel-id <id>` before enabling Omnibus for these channels.',
          },
          { status: 422 },
        )
      }
    }

    const merged = { ...(existing as Record<string, unknown>), ...parsed }
    await moduleConfigService.setValue(OMNIBUS_MODULE_ID, OMNIBUS_CONFIG_KEY, merged)
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
