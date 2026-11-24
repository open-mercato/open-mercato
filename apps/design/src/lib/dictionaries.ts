import appEnglish from '../../../mercato/src/i18n/en.json'
import galleryEnglish from '../../../../packages/core/src/modules/design_system/i18n/en.json'
import { designDictionary } from './design-dictionary'
import type { Dictionary } from './translate'

export function previewDictionary(): Dictionary {
  return { ...appEnglish, ...galleryEnglish, ...designDictionary }
}
