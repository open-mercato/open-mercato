import {
  ICON_LIBRARY,
  ICON_SUGGESTIONS,
  type IconOption,
  type DictionaryDisplayEntry,
  type DictionaryMap,
  createDictionaryMap,
  normalizeDictionaryEntries,
  DictionaryValue,
  renderDictionaryColor,
  renderDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

export type CustomerDictionaryKind = 'statuses' | 'sources' | 'lifecycle-stages' | 'address-types'
export type CustomerDictionaryDisplayEntry = DictionaryDisplayEntry
export type CustomerDictionaryMap = DictionaryMap

export {
  ICON_LIBRARY,
  ICON_SUGGESTIONS,
  type IconOption,
  DictionaryValue,
  createDictionaryMap,
  normalizeDictionaryEntries,
  renderDictionaryColor,
  renderDictionaryIcon,
}
