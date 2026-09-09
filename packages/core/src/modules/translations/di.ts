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

// Registered at module scope, not inside `register()`: module DI registrars only
// run when the first request container is built, and the root layout resolves the
// served locale set without ever building one. Inside `register()` the very first
// render of a fresh process would find an empty resolver slot and serve the
// un-narrowed set. `di.generated.ts` imports this module statically from the app
// bootstrap, so the slot is filled at import time instead.
registerSupportedLocalesResolver(resolveTenantSupportedLocales)

export function register() {
  registerTranslatableFields(catalogFields)
  registerTranslatableFields(dictionaryFields)
  registerTranslatableFields(entitiesFields)
  registerTranslatableFields(resourcesFields)
  registerTranslationOverlayPlugin(applyTranslationOverlays, resolveLocaleFromRequest)
}
