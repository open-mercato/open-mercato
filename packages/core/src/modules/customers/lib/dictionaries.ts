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

export const CUSTOMER_DICTIONARY_KINDS = [
  'statuses',
  'sources',
  'lifecycle-stages',
  'address-types',
  'activity-types',
  'deal-statuses',
  'pipeline-stages',
  'job-titles',
  'industries',
  'temperature',
  'renewal-quarters',
  'person-company-roles',
  'interaction-statuses',
] as const

export type CustomerDictionaryKind = typeof CUSTOMER_DICTIONARY_KINDS[number]
export type CustomerDictionaryDisplayEntry = DictionaryDisplayEntry
export type CustomerDictionaryMap = DictionaryMap

export const CUSTOMER_DICTIONARIES_MANAGE_HREF = '/backend/config/customers'
export const CUSTOMER_DICTIONARY_ORGANIZATION_REQUIRED_CODE = 'customer_dictionary_organization_required'

export function getCustomerDictionarySettingsSectionId(kind: CustomerDictionaryKind) {
  return `customer-dictionary-${kind}`
}

export function getCustomerDictionaryManageHref(kind: CustomerDictionaryKind) {
  return `${CUSTOMER_DICTIONARIES_MANAGE_HREF}#${getCustomerDictionarySettingsSectionId(kind)}`
}

export function createEmptyCustomerDictionaryMaps(): Record<CustomerDictionaryKind, CustomerDictionaryMap> {
  return CUSTOMER_DICTIONARY_KINDS.reduce<Record<CustomerDictionaryKind, CustomerDictionaryMap>>(
    (acc, kind) => {
      acc[kind] = {}
      return acc
    },
    {} as Record<CustomerDictionaryKind, CustomerDictionaryMap>,
  )
}

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
