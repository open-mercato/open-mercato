import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { registerSupportedLocalesResolver } from '@open-mercato/shared/lib/i18n/locale-registry'
import { translatableFields as catalogFields } from '../catalog/translations'
import { translatableFields as dictionaryFields } from '../dictionaries/translations'
import { translatableFields as entitiesFields } from '../entities/translations'
import { translatableFields as resourcesFields } from '../resources/translations'
import { applyTranslationOverlays } from './lib/apply'
import { resolveLocaleFromRequest } from './lib/locale'
import { resolveTenantSupportedLocales } from './lib/supported-locales'

export function register() {
  registerTranslatableFields(catalogFields)
  registerTranslatableFields(dictionaryFields)
  registerTranslatableFields(entitiesFields)
  registerTranslatableFields(resourcesFields)
  registerTranslationOverlayPlugin(applyTranslationOverlays, resolveLocaleFromRequest)
  // Makes the tenant's Settings → Translations locale selection the source of
  // truth for the UI locale set too, not just the content-translation editor.
  registerSupportedLocalesResolver(resolveTenantSupportedLocales)
}
