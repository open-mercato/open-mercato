import { registerTranslatableFieldExpander } from '@open-mercato/shared/lib/localization/translatable-fields'
import { normalizeCustomFieldOptions } from '@open-mercato/shared/modules/entities/options'

const fieldDefinitionType = 'entities:custom_field_def'

export const translatableFields: Record<string, string[]> = {
  [fieldDefinitionType]: ['label', 'description'],
}

registerTranslatableFieldExpander(fieldDefinitionType, (record) => {
  const config = record.config_json ?? record.configJson
  const options = config && typeof config === 'object' && 'options' in config ? config.options : undefined
  return normalizeCustomFieldOptions(options).map(({ value, label }) => ({
    key: `options.${value}.label`,
    label,
    baseValue: label,
  }))
})

export default translatableFields
