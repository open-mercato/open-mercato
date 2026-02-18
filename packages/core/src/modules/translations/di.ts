import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { translatableFields as catalogFields } from '../catalog/translations'
import { translatableFields as dictionaryFields } from '../dictionaries/translations'
import { translatableFields as entitiesFields } from '../entities/translations'
import { applyTranslationOverlays } from './lib/apply'
import { resolveLocaleFromRequest } from './lib/locale'

export function register() {
  registerTranslatableFields(catalogFields)
  registerTranslatableFields(dictionaryFields)
  registerTranslatableFields(entitiesFields)
  registerTranslationOverlayPlugin(applyTranslationOverlays, resolveLocaleFromRequest)
}
