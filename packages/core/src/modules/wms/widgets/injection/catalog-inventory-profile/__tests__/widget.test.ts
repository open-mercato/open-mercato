import widget from '../widget'
import {
  decodeCatalogInventoryProfileIntent,
  WMS_CATALOG_PROFILE_HEADER,
} from '../../../../lib/catalogInventoryProfileIntent'

type BeforeSaveResult = {
  ok: boolean
  requestHeaders?: Record<string, string>
  fieldErrors?: Record<string, string>
}

const loadedProfile = {
  inventoryProfile: {
    defaultUom: 'pcs',
    defaultStrategy: 'fifo',
    trackLot: true,
    trackSerial: false,
    trackExpiration: false,
    reorderPoint: '5',
    safetyStock: '2',
  },
}

async function beforeSave(data: Record<string, unknown>): Promise<BeforeSaveResult> {
  const handler = widget.eventHandlers?.onBeforeSave
  if (!handler) throw new Error('onBeforeSave is not defined')
  return (await handler(data, {} as never)) as BeforeSaveResult
}

function decodedIntent(result: BeforeSaveResult) {
  const header = result.requestHeaders?.[WMS_CATALOG_PROFILE_HEADER]
  return header ? decodeCatalogInventoryProfileIntent(header) : null
}

describe('wms catalog inventory profile widget onBeforeSave (#6142)', () => {
  it('sends no profile intent when the record has no loaded profile and inventory is unmanaged', async () => {
    const result = await beforeSave({ title: 'Widget', 'wms.manageInventory': false, _wms: { inventoryProfile: null } })
    expect(result).toEqual({ ok: true })
  })

  it('sends no profile intent when the profile state never reached the form', async () => {
    const result = await beforeSave({ title: 'Widget', _wms: loadedProfile })
    expect(result).toEqual({ ok: true })
  })

  it('sends no profile intent when the enrichment is missing, so an enricher fallback cannot delete a profile', async () => {
    const result = await beforeSave({ title: 'Widget', 'wms.manageInventory': false })
    expect(result).toEqual({ ok: true })
  })

  it('sends a removal intent only when a loaded profile is explicitly switched off', async () => {
    const result = await beforeSave({ 'wms.manageInventory': false, _wms: loadedProfile })
    expect(result.ok).toBe(true)
    expect(decodedIntent(result)?.manageInventory).toBe(false)
  })

  it('sends the managed profile intent with the form values', async () => {
    const result = await beforeSave({
      'wms.manageInventory': true,
      'wms.defaultUom': 'pcs',
      'wms.defaultStrategy': 'fefo',
      'wms.trackExpiration': true,
      'wms.reorderPoint': '5',
      'wms.safetyStock': 2,
    })
    expect(result.ok).toBe(true)
    expect(decodedIntent(result)).toMatchObject({
      manageInventory: true,
      defaultUom: 'pcs',
      defaultStrategy: 'fefo',
      trackExpiration: true,
      reorderPoint: 5,
      safetyStock: 2,
    })
  })

  it('blocks the save with field errors when a managed profile is incomplete', async () => {
    const result = await beforeSave({
      'wms.manageInventory': true,
      'wms.defaultUom': '',
      'wms.defaultStrategy': 'fifo',
      'wms.trackExpiration': true,
      'wms.reorderPoint': -1,
    })
    expect(result.ok).toBe(false)
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['wms.defaultStrategy', 'wms.defaultUom', 'wms.reorderPoint'])
  })
})

describe('wms catalog inventory profile widget transformDisplayData', () => {
  it('maps a loaded profile onto the injected form fields', async () => {
    const handler = widget.eventHandlers?.transformDisplayData
    if (!handler) throw new Error('transformDisplayData is not defined')
    const result = (await handler({ _wms: loadedProfile }, {} as never)) as Record<string, unknown>
    expect(result).toMatchObject({
      'wms.manageInventory': true,
      'wms.defaultUom': 'pcs',
      'wms.trackLot': true,
      'wms.reorderPoint': 5,
      'wms.safetyStock': 2,
    })
  })
})
