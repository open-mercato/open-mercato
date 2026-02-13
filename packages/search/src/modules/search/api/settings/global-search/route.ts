import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  resolveGlobalSearchStrategies,
  saveGlobalSearchStrategies,
  DEFAULT_GLOBAL_SEARCH_STRATEGIES,
} from '../../../lib/global-search-config'
import type { SearchStrategyId } from '@open-mercato/shared/modules/search'
import { globalSearchSettingsOpenApi } from '../../openapi'

const updateSchema = z.object({
  enabledStrategies: z.array(z.enum(['fulltext', 'vector', 'tokens'])).min(1),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
  POST: { requireAuth: true, requireFeatures: ['search.manage'] },
}

type SettingsResponse = {
  enabledStrategies: SearchStrategyId[]
}

const toJson = (payload: SettingsResponse, init?: ResponseInit) => NextResponse.json(payload, init)

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const enabledStrategies = await resolveGlobalSearchStrategies(container, {
      defaultValue: DEFAULT_GLOBAL_SEARCH_STRATEGIES,
    })

    return toJson({ enabledStrategies })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: t('api.errors.invalidPayload', 'Invalid request body') },
      { status: 400 }
    )
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: t('search.api.errors.invalidStrategies', 'Invalid strategies configuration') },
      { status: 400 }
    )
  }

  const container = await createRequestContainer()
  try {
    await saveGlobalSearchStrategies(container, parsed.data.enabledStrategies)

    return NextResponse.json({ ok: true, enabledStrategies: parsed.data.enabledStrategies })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : t('api.errors.internal', 'Internal error') },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = globalSearchSettingsOpenApi
