import { registerTranslatableFieldExpander } from '@open-mercato/shared/lib/localization/translatable-fields'
import {
  OPTION_SCHEMA_TEMPLATE_ENTITY_TYPE,
  expandOptionSchemaTranslationFields,
} from './lib/optionSchemaTranslations'

export const translatableFields: Record<string, string[]> = {
  'catalog:catalog_product': ['title', 'subtitle', 'description', 'seoTitle', 'seoDescription'],
  'catalog:catalog_product_variant': ['name'],
  'catalog:catalog_offer': ['title', 'subtitle', 'description'],
  'catalog:catalog_option_schema_template': ['name', 'description'],
  'catalog:catalog_product_category': ['name', 'description'],
  'catalog:catalog_product_tag': ['label'],
}

registerTranslatableFieldExpander(OPTION_SCHEMA_TEMPLATE_ENTITY_TYPE, expandOptionSchemaTranslationFields)

export default translatableFields
