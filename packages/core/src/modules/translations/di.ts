import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { catalogTranslatableFields } from '../catalog/lib/translatable-fields'
import { dictionaryTranslatableFields } from '../dictionaries/lib/translatable-fields'

export function register() {
  registerTranslatableFields(catalogTranslatableFields)
  registerTranslatableFields(dictionaryTranslatableFields)
  registerTranslatableFields({ 'entities:custom_field_def': ['label', 'description'] })
}
