import { readDateLocaleEnv, resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'

/**
 * The settings the plain (non-hook) display helpers use when none are passed explicitly.
 *
 * Components that can render during SSR, or that memoize formatted labels, should read
 * `useDateLocaleSettings()` and pass the settings explicitly: the context carries the tenant/user
 * values on the server too and re-renders consumers after a settings change, while this store is
 * client-only and not reactive.
 *
 * Only the browser keeps a module-level value: the `DateLocaleSettingsProvider` mirrors the
 * resolved tenant/user settings here on the client. On the server a module-level value would be
 * shared by concurrent requests of different tenants, so server renders always fall back to the
 * public env defaults unless the caller passes settings.
 */
let clientSettings: ResolvedDateLocaleSettings | null = null

/**
 * Providers nest (root layout → backend/portal layout), and the innermost one on screen must win.
 * A root provider re-renders on every navigation (its parent reads the pathname) while a nested
 * one usually does not, so "last render wins" would hand the store back to the root's anonymous
 * defaults after a client-side login. Each provider therefore registers with its nesting depth:
 * mounted providers in an effect, and the provider rendering right now (hydration, or a nested
 * layout appearing after a navigation) before its effects have run.
 */
type ProviderEntry = { depth: number; settings: ResolvedDateLocaleSettings | null }
const mountedProviders = new Map<object, ProviderEntry>()
let renderingProvider: (ProviderEntry & { key: object }) | null = null

function innermostProviderSettings(): ProviderEntry | null {
  let innermost: ProviderEntry | null = null
  for (const entry of mountedProviders.values()) {
    if (!innermost || entry.depth > innermost.depth) innermost = entry
  }
  if (renderingProvider && (!innermost || renderingProvider.depth >= innermost.depth)) innermost = renderingProvider
  return innermost
}

/** Called by `DateLocaleSettingsProvider` while it renders. Browser only. */
export function noteRenderingDateLocaleProvider(key: object, depth: number, settings: ResolvedDateLocaleSettings | null): void {
  if (typeof window === 'undefined') return
  renderingProvider = { key, depth, settings }
}

/**
 * Called by every `DateLocaleSettingsProvider` after each commit. Every provider that rendered in
 * that commit is mounted by now, so the render-time note is no longer needed; a note left by a
 * render React discarded (an interrupted transition, an error boundary) must not keep deciding.
 */
export function clearRenderingDateLocaleProvider(): void {
  renderingProvider = null
}

/** Called by `DateLocaleSettingsProvider` once mounted (and when its value changes). Browser only. */
export function registerDateLocaleProvider(key: object, depth: number, settings: ResolvedDateLocaleSettings | null): void {
  if (typeof window === 'undefined') return
  mountedProviders.set(key, { depth, settings })
}

export function unregisterDateLocaleProvider(key: object): void {
  mountedProviders.delete(key)
  if (renderingProvider?.key === key) renderingProvider = null
}

// `NEXT_PUBLIC_*` reads must stay literal so Next.js can inline them into the client bundle.
function readPublicEnvSettings(): ResolvedDateLocaleSettings {
  return resolveDateLocaleSettings({
    env: readDateLocaleEnv({
      NEXT_PUBLIC_OM_DATE_FORMAT: process.env.NEXT_PUBLIC_OM_DATE_FORMAT,
      NEXT_PUBLIC_OM_DATE_TIME_FORMAT: process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT,
      NEXT_PUBLIC_OM_TIME_FORMAT: process.env.NEXT_PUBLIC_OM_TIME_FORMAT,
      NEXT_PUBLIC_DATE_FORMAT: process.env.NEXT_PUBLIC_DATE_FORMAT,
      NEXT_PUBLIC_DATE_TIME_FORMAT: process.env.NEXT_PUBLIC_DATE_TIME_FORMAT,
    }),
  })
}

export function setClientDateLocaleSettings(settings: ResolvedDateLocaleSettings | null): void {
  if (typeof window === 'undefined') return
  clientSettings = settings
}

export function getActiveDateLocaleSettings(): ResolvedDateLocaleSettings {
  if (typeof window !== 'undefined') {
    const provided = innermostProviderSettings()?.settings ?? clientSettings
    if (provided) return provided
  }
  return readPublicEnvSettings()
}
