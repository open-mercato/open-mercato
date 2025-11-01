import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { envDisablesVectorAutoIndexing, resolveVectorAutoIndexingEnabled, VECTOR_AUTO_INDEX_CONFIG_KEY } from '../../lib/auto-indexing'

const updateSchema = z.object({
  autoIndexingEnabled: z.boolean(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['vector.view'] },
  POST: { requireAuth: true, requireFeatures: ['vector.manage'] },
}

type SettingsResponse = {
  settings: {
    openaiConfigured: boolean
    autoIndexingEnabled: boolean
    autoIndexingLocked: boolean
    lockReason: string | null
  }
}

const openAiConfigured = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0)

const toJson = (payload: SettingsResponse, init?: ResponseInit) => NextResponse.json(payload, init)

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

const configUnavailable = () => NextResponse.json({ error: 'Configuration service unavailable' }, { status: 503 })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return unauthorized()

  const container = await createRequestContainer()
  try {
    const lockedByEnv = envDisablesVectorAutoIndexing()
    let enabled = !lockedByEnv
    if (!lockedByEnv) {
      try {
        enabled = await resolveVectorAutoIndexingEnabled(container, { defaultValue: true })
      } catch {
        enabled = true
      }
    }
    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: lockedByEnv ? false : enabled,
        autoIndexingLocked: lockedByEnv,
        lockReason: lockedByEnv ? 'env' : null,
      },
    })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return unauthorized()

  if (envDisablesVectorAutoIndexing()) {
    return NextResponse.json(
      { error: 'Auto-indexing is disabled via DISABLE_VECTOR_SEARCH_AUTOINDEXING.' },
      { status: 409 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  const container = await createRequestContainer()
  try {
    let service: ModuleConfigService
    try {
      service = (container.resolve('moduleConfigService') as ModuleConfigService)
    } catch {
      return configUnavailable()
    }

    await service.setValue('vector', VECTOR_AUTO_INDEX_CONFIG_KEY, parsed.data.autoIndexingEnabled)

    return toJson({
      settings: {
        openaiConfigured: openAiConfigured(),
        autoIndexingEnabled: parsed.data.autoIndexingEnabled,
        autoIndexingLocked: false,
        lockReason: null,
      },
    })
  } catch (error) {
    console.error('[vector.settings.update] failed', error)
    return NextResponse.json({ error: 'Failed to update vector settings.' }, { status: 500 })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
