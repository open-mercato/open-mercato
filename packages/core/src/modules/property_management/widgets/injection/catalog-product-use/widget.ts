import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
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

type Translate = (key: string, fallback?: string) => string
type UseIntent = { use: 'leasable' | 'bookable' | null; billingUnit: 'month' | 'hour' | 'day' | null }

function changedIntent(data: unknown): UseIntent | null {
  const source = asRecord(data)
  if (!source || !(USE_FIELD in source)) return null
  const use = readUse(source[USE_FIELD])
  const loaded = asRecord(source._property_management)
  const billingUnit = use === 'leasable' ? 'month' : use === 'bookable' ? readBillingUnit(source[BILLING_FIELD]) ?? 'hour' : null
  if (use === readUse(loaded?.use) && (use === null || billingUnit === readBillingUnit(loaded?.billingUnit))) return null
  return { use, billingUnit }
}

function savedProductId(context: unknown): string | null {
  const source = asRecord(context)
  const id = source?.resourceId ?? source?.recordId
  return typeof id === 'string' && id ? id : null
}

async function storedUseMatches(productId: string, intent: UseIntent): Promise<boolean | null> {
  const query = new URLSearchParams({ productIds: productId, pageSize: '1' })
  const call = await apiCall<{ items?: unknown[] }>(`/api/property_management/product-uses?${query.toString()}`, undefined, { fallback: {} })
  if (!call.ok) return null
  const stored = asRecord(Array.isArray(call.result?.items) ? call.result.items[0] : null)
  const use = readUse(stored?.use)
  return use === intent.use && (use === null || readBillingUnit(stored?.billingUnit) === intent.billingUnit)
}

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'property_management.injection.catalog-product-use',
    priority: 110,
    features: ['property_management.manage', 'property_management.buildings.manage_all'],
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
      const intent = changedIntent(data)
      if (!intent) return { ok: true }
      const sourceEntityId = typeof context?.entityId === 'string' ? context.entityId : ''
      return {
        ok: true,
        requestHeaders: {
          [PRODUCT_USE_INTENT_HEADER]: encodeProductUseIntent({ sourceEntityId, ...intent }),
        },
      }
    },
    async onAfterSave(data, context) {
      const intent = changedIntent(data)
      const productId = savedProductId(context)
      if (!intent || !productId) return
      if ((await storedUseMatches(productId, intent)) !== false) return
      const translate: Translate = typeof context?.t === 'function' ? (context.t as Translate) : (_key, fallback) => fallback ?? ''
      flash(
        translate(
          'property_management.errors.productUseSyncFailed',
          'The product was saved, but its property use could not be updated. Open the product and set it again.',
        ),
        'warning',
      )
    },
  },
}

export default widget
