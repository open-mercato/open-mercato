import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

const logger = createLogger('translations').child({ component: 'supported-locales' })

export const SUPPORTED_LOCALES_CONFIG_MODULE = 'translations'
export const SUPPORTED_LOCALES_CONFIG_NAME = 'supported_locales'

/**
 * The locale codes the signed-in user's tenant has opted into, as managed on
 * Settings → Module Configs → Translations, or `null` when there is no tenant
 * context or the tenant has never saved a selection.
 *
 * `null` means "no opinion" and leaves the served set untouched — it is not the
 * same as an empty selection. Reads go through `ModuleConfigService`, which
 * caches for 60s and invalidates on write, so this stays cheap enough to call
 * once per page render.
 */
export async function resolveTenantSupportedLocales(): Promise<readonly string[] | null> {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return null

    const container = await createRequestContainer()
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const configured = await configService.getValue<string[]>(
      SUPPORTED_LOCALES_CONFIG_MODULE,
      SUPPORTED_LOCALES_CONFIG_NAME,
      { defaultValue: null, scope: { tenantId: auth.tenantId } },
    )

    if (!Array.isArray(configured)) return null
    const codes = configured.filter((code): code is string => typeof code === 'string' && code.length > 0)
    return codes.length > 0 ? codes : null
  } catch (err) {
    // Anonymous requests, a container that cannot be built yet during boot, or a
    // database that is briefly unavailable must not break locale detection —
    // the caller falls back to the full supported set.
    logger.debug('Could not resolve tenant supported locales', { err })
    return null
  }
}
