import { resolveDevRuntimeServerConfig } from './server'
import {
  DEV_RUNTIME_BANNER_META_NAME,
  DEV_RUNTIME_LOGS_URL_META_NAME,
  DEV_RUNTIME_TOKEN_META_NAME,
} from './types'

export type DevRuntimeLayoutMeta = {
  name: string
  content: string
}

export type DevRuntimeLayoutConfig = {
  enabled: boolean
  bannerEnabled: boolean
  meta: DevRuntimeLayoutMeta[]
}

const DISABLED: DevRuntimeLayoutConfig = { enabled: false, bannerEnabled: false, meta: [] }

/**
 * Server-side helper for the app layout. It exposes the per-run token to the
 * local dev browser through dev-only `<meta>` elements without adding a context
 * provider, and returns nothing at all outside a supervised dev runtime.
 */
export function resolveDevRuntimeLayoutConfig(env: NodeJS.ProcessEnv = process.env): DevRuntimeLayoutConfig {
  const config = resolveDevRuntimeServerConfig(env)
  if (!config.enabled || !config.token) return DISABLED

  const meta: DevRuntimeLayoutMeta[] = [
    { name: DEV_RUNTIME_TOKEN_META_NAME, content: config.token },
    { name: DEV_RUNTIME_BANNER_META_NAME, content: config.bannerEnabled ? '1' : '0' },
  ]

  const logsUrl = typeof env.OM_DEV_RUNTIME_SPLASH_URL === 'string' ? env.OM_DEV_RUNTIME_SPLASH_URL.trim() : ''
  if (logsUrl) meta.push({ name: DEV_RUNTIME_LOGS_URL_META_NAME, content: logsUrl })

  return { enabled: true, bannerEnabled: config.bannerEnabled, meta }
}
