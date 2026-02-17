import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { registerTranslationOverlayPlugin } from '@open-mercato/shared/lib/localization/overlay-plugin'
import { catalogTranslatableFields } from '../catalog/lib/translatable-fields'
import { dictionaryTranslatableFields } from '../dictionaries/lib/translatable-fields'
import { applyTranslationOverlays } from './lib/apply'
import { resolveLocaleFromRequest } from './lib/locale'

export function register() {
  registerTranslatableFields(catalogTranslatableFields)
  registerTranslatableFields(dictionaryTranslatableFields)
  registerTranslatableFields({ 'entities:custom_field_def': ['label', 'description'] })
  registerTranslationOverlayPlugin(applyTranslationOverlays, resolveLocaleFromRequest)
}
