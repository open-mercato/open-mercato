import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import {
  encodeCatalogInventoryProfileIntent,
  WMS_CATALOG_PROFILE_HEADER,
  type CatalogInventoryProfileIntent,
} from '../../../lib/catalogInventoryProfileIntent'

type RecordLike = Record<string, unknown>

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as RecordLike
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function buildIntent(data: RecordLike): CatalogInventoryProfileIntent {
  return {
    manageInventory: readBoolean(data['wms.manageInventory']),
    defaultUom: readString(data['wms.defaultUom']).trim() || null,
    defaultStrategy: (() => {
      const strategy = readString(data['wms.defaultStrategy']).trim()
      return strategy === 'fifo' || strategy === 'lifo' || strategy === 'fefo'
        ? strategy
        : undefined
    })(),
    trackLot: readBoolean(data['wms.trackLot']),
    trackSerial: readBoolean(data['wms.trackSerial']),
    trackExpiration: readBoolean(data['wms.trackExpiration']),
    reorderPoint: readNumber(data['wms.reorderPoint']) ?? 0,
    safetyStock: readNumber(data['wms.safetyStock']) ?? 0,
  }
}

function buildDisplayState(data: RecordLike): RecordLike {
  const wms = asRecord(data._wms)
  const inventoryProfile = asRecord(wms?.inventoryProfile)
  const fallbackDefaultUom = readString(data.defaultUnit).trim()

  return {
    ...data,
    'wms.manageInventory': Boolean(inventoryProfile),
    'wms.defaultUom':
      readString(inventoryProfile?.defaultUom).trim() ||
      fallbackDefaultUom,
    'wms.defaultStrategy':
      readString(inventoryProfile?.defaultStrategy).trim() || 'fifo',
    'wms.trackLot': readBoolean(inventoryProfile?.trackLot),
    'wms.trackSerial': readBoolean(inventoryProfile?.trackSerial),
    'wms.trackExpiration': readBoolean(inventoryProfile?.trackExpiration),
    'wms.reorderPoint':
      readNumber(inventoryProfile?.reorderPoint) ?? 0,
    'wms.safetyStock':
      readNumber(inventoryProfile?.safetyStock) ?? 0,
  }
}

const visibleWhenManaged = {
  field: 'wms.manageInventory',
  operator: 'eq' as const,
  value: true,
}

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'wms.injection.catalog-inventory-profile',
    priority: 120,
    features: ['wms.manage_inventory'],
  },
  fields: [
    {
      id: 'wms.manageInventory',
      label: 'Manage inventory with WMS',
      labelKey: 'wms.widgets.catalog.inventoryProfile.manageInventory',
      type: 'boolean',
      group: 'wms.inventoryProfile',
    },
    {
      id: 'wms.defaultUom',
      label: 'Default UOM',
      labelKey: 'wms.widgets.catalog.inventoryProfile.defaultUom',
      type: 'text',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
    {
      id: 'wms.defaultStrategy',
      label: 'Rotation strategy',
      labelKey: 'wms.widgets.catalog.inventoryProfile.defaultStrategy',
      type: 'select',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
      options: [
        {
          value: 'fifo',
          label: 'FIFO',
          labelKey: 'wms.widgets.catalog.inventoryProfile.strategy.fifo',
        },
        {
          value: 'lifo',
          label: 'LIFO',
          labelKey: 'wms.widgets.catalog.inventoryProfile.strategy.lifo',
        },
        {
          value: 'fefo',
          label: 'FEFO',
          labelKey: 'wms.widgets.catalog.inventoryProfile.strategy.fefo',
        },
      ],
    },
    {
      id: 'wms.trackLot',
      label: 'Track lots',
      labelKey: 'wms.widgets.catalog.inventoryProfile.trackLot',
      type: 'boolean',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
    {
      id: 'wms.trackSerial',
      label: 'Track serials',
      labelKey: 'wms.widgets.catalog.inventoryProfile.trackSerial',
      type: 'boolean',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
    {
      id: 'wms.trackExpiration',
      label: 'Track expiration',
      labelKey: 'wms.widgets.catalog.inventoryProfile.trackExpiration',
      type: 'boolean',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
    {
      id: 'wms.reorderPoint',
      label: 'Reorder point',
      labelKey: 'wms.widgets.catalog.inventoryProfile.reorderPoint',
      type: 'number',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
    {
      id: 'wms.safetyStock',
      label: 'Safety stock',
      labelKey: 'wms.widgets.catalog.inventoryProfile.safetyStock',
      type: 'number',
      group: 'wms.inventoryProfile',
      visibleWhen: visibleWhenManaged,
    },
  ],
  eventHandlers: {
    async transformDisplayData(data) {
      const source = asRecord(data)
      if (!source) return data
      return buildDisplayState(source) as typeof data
    },
    async onBeforeSave(data) {
      const source = asRecord(data)
      if (!source) return { ok: true }

      const intent = buildIntent(source)
      if (!intent.manageInventory) {
        return {
          ok: true,
          requestHeaders: {
            [WMS_CATALOG_PROFILE_HEADER]:
              encodeCatalogInventoryProfileIntent(intent),
          },
        }
      }

      const fieldErrors: Record<string, string> = {}
      if (!intent.defaultUom) {
        fieldErrors['wms.defaultUom'] =
          'wms.widgets.catalog.inventoryProfile.errors.defaultUomRequired'
      }
      if (!intent.defaultStrategy) {
        fieldErrors['wms.defaultStrategy'] =
          'wms.widgets.catalog.inventoryProfile.errors.strategyRequired'
      }
      if (
        intent.trackExpiration &&
        intent.defaultStrategy &&
        intent.defaultStrategy !== 'fefo'
      ) {
        fieldErrors['wms.defaultStrategy'] =
          'wms.widgets.catalog.inventoryProfile.errors.fefoRequired'
      }
      if (
        typeof intent.reorderPoint === 'number' &&
        intent.reorderPoint < 0
      ) {
        fieldErrors['wms.reorderPoint'] =
          'wms.widgets.catalog.inventoryProfile.errors.nonNegative'
      }
      if (
        typeof intent.safetyStock === 'number' &&
        intent.safetyStock < 0
      ) {
        fieldErrors['wms.safetyStock'] =
          'wms.widgets.catalog.inventoryProfile.errors.nonNegative'
      }

      if (Object.keys(fieldErrors).length > 0) {
        return {
          ok: false,
          fieldErrors,
        }
      }

      return {
        ok: true,
        requestHeaders: {
          [WMS_CATALOG_PROFILE_HEADER]:
            encodeCatalogInventoryProfileIntent(intent),
        },
      }
    },
  },
}

export default widget
