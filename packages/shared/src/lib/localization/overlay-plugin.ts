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

let _overlayFn: TranslationOverlayFn | null = null
let _resolveLocaleFn: ResolveLocaleFromRequestFn | null = null

export function registerTranslationOverlayPlugin(
  overlay: TranslationOverlayFn,
  resolveLocale: ResolveLocaleFromRequestFn,
): void {
  _overlayFn = overlay
  _resolveLocaleFn = resolveLocale
}

export function getTranslationOverlayPlugin(): {
  overlay: TranslationOverlayFn | null
  resolveLocale: ResolveLocaleFromRequestFn | null
} {
  return { overlay: _overlayFn, resolveLocale: _resolveLocaleFn }
}
