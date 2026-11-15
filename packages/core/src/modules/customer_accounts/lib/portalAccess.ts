import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'

export async function requireCustomerPortalEnabled(container: AppContainer, tenantId: string): Promise<void> {
  const service = container.resolve<FeatureTogglesService | undefined>('featureTogglesService', {
    allowUnregistered: true,
  })
  if (!service) return

  const result = await service.getBoolConfig('portal_enabled', tenantId)
  if (result.ok && result.value) return
  if (!result.ok && result.error.code === 'MISSING_TOGGLE') return

  const { translate } = await resolveTranslations()
  throw new CrudHttpError(result.ok ? 403 : 503, {
    ok: false,
    error: translate('portal.disabled.title'),
  })
}
