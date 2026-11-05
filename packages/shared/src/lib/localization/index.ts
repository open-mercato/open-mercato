export type { TranslationRecord, LocaleCode } from './types'
export { applyLocalizedContent } from './resolver'
export {
  registerTranslatableFields,
  getTranslatableFields,
  getTranslatableFieldsRegistry,
  registerTranslatableFieldExpander,
  getTranslatableFieldExpander,
} from './translatable-fields'
export type { TranslatableFieldExpansion, TranslatableFieldExpander } from './translatable-fields'
export { registerTranslationOverlayPlugin, getTranslationOverlayPlugin } from './overlay-plugin'
export type { TranslationOverlayFn, ResolveLocaleFromRequestFn } from './overlay-plugin'
