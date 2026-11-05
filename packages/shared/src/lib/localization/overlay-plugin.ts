import type { AwilixContainer } from 'awilix'

export type TranslationOverlayFn = (
  items: Record<string, unknown>[],
  options: {
    entityType: string
    locale: string
    tenantId?: string | null
    organizationId?: string | null
    container: AwilixContainer
  },
) => Promise<Record<string, unknown>[]>

export type ResolveLocaleFromRequestFn = (request: Request) => string | null

type OverlayPluginState = {
  overlay: TranslationOverlayFn | null
  resolveLocale: ResolveLocaleFromRequestFn | null
}

// Use globalThis to survive Turbopack/esbuild module duplication where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoTranslationOverlay__'

function getGlobal(): OverlayPluginState | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobal(state: OverlayPluginState): void {
  (globalThis as any)[GLOBAL_KEY] = state
}

export function registerTranslationOverlayPlugin(
  overlay: TranslationOverlayFn | null,
  resolveLocale: ResolveLocaleFromRequestFn | null,
): void {
  setGlobal({ overlay, resolveLocale })
}

export function getTranslationOverlayPlugin(): {
  overlay: TranslationOverlayFn | null
  resolveLocale: ResolveLocaleFromRequestFn | null
} {
  const state = getGlobal()
  return state ?? { overlay: null, resolveLocale: null }
}
