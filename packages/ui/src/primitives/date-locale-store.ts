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
  if (typeof window !== 'undefined' && clientSettings) return clientSettings
  return readPublicEnvSettings()
}
