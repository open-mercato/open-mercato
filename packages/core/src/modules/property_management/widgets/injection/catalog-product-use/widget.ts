import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { encodeProductUseIntent, PRODUCT_USE_INTENT_HEADER } from '../../../lib/productUseIntent'

type RecordLike = Record<string, unknown>

const USE_FIELD = 'property_management.use'
const BILLING_FIELD = 'property_management.billingUnit'
const NONE = 'none'

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as RecordLike
}

function readUse(value: unknown): 'leasable' | 'bookable' | null {
  return value === 'leasable' || value === 'bookable' ? value : null
}

function readBillingUnit(value: unknown): 'month' | 'hour' | 'day' | null {
  return value === 'month' || value === 'hour' || value === 'day' ? value : null
}

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'property_management.injection.catalog-product-use',
    priority: 110,
    features: ['property_management.manage'],
  },
  fields: [
    {
      id: USE_FIELD,
      label: 'Use in Property Management',
      labelKey: 'property_management.widgets.productUse.use',
      type: 'select',
      group: 'property_management.productUse',
      options: [
        { value: NONE, label: 'Not used for units', labelKey: 'property_management.widgets.productUse.none' },
        { value: 'leasable', label: 'Leasable (billed per month)', labelKey: 'property_management.widgets.productUse.leasable' },
        { value: 'bookable', label: 'Bookable', labelKey: 'property_management.widgets.productUse.bookable' },
      ],
    },
    {
      id: BILLING_FIELD,
      label: 'Booked per',
      labelKey: 'property_management.widgets.productUse.billingUnit',
      type: 'select',
      group: 'property_management.productUse',
      visibleWhen: { field: USE_FIELD, operator: 'eq', value: 'bookable' },
      options: [
        { value: 'hour', label: 'Hour', labelKey: 'property_management.widgets.productUse.hour' },
        { value: 'day', label: 'Day', labelKey: 'property_management.widgets.productUse.day' },
      ],
    },
  ],
  eventHandlers: {
    async transformDisplayData(data) {
      const source = asRecord(data)
      if (!source) return data
      const enrichment = asRecord(source._property_management)
      const use = readUse(enrichment?.use)
      return {
        ...source,
        [USE_FIELD]: use ?? NONE,
        [BILLING_FIELD]: readBillingUnit(enrichment?.billingUnit) === 'day' ? 'day' : 'hour',
      } as typeof data
    },
    async onBeforeSave(data, context) {
      const source = asRecord(data)
      if (!source || !(USE_FIELD in source)) return { ok: true }
      const use = readUse(source[USE_FIELD])
      const loaded = readUse(asRecord(source._property_management)?.use)
      const billingUnit = use === 'leasable' ? 'month' : use === 'bookable' ? readBillingUnit(source[BILLING_FIELD]) ?? 'hour' : null
      const loadedBilling = readBillingUnit(asRecord(source._property_management)?.billingUnit)
      if (use === loaded && (use === null || billingUnit === loadedBilling)) return { ok: true }
      const sourceEntityId = typeof context?.entityId === 'string' ? context.entityId : ''
      return {
        ok: true,
        requestHeaders: {
          [PRODUCT_USE_INTENT_HEADER]: encodeProductUseIntent({ sourceEntityId, use, billingUnit }),
        },
      }
    },
  },
}

export default widget
