import {
  createIdsLookupSource,
  lookupLabelWithCode,
  pickLookupString,
} from '@open-mercato/ui/backend/inputs/lookupSources'

export type { LookupOption, LookupSource } from '@open-mercato/ui/backend/inputs/lookupSources'
export {
  categoryLookupSource,
  productLookupSource,
  tagLookupSource,
} from '@open-mercato/core/modules/catalog/components/lookupSources'

export const salesChannelLookupSource = createIdsLookupSource('sales-channels', '/api/sales/channels', (item) => {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  return { value, label: lookupLabelWithCode(pickLookupString(item, 'name') || value, pickLookupString(item, 'code')) }
})

export const priceKindLookupSource = createIdsLookupSource('price-kinds', '/api/catalog/price-kinds', (item) => {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  return { value, label: lookupLabelWithCode(pickLookupString(item, 'title', 'name') || value, pickLookupString(item, 'code')) }
})
