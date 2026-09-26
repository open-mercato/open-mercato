import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { buildZatcaQrPayload } from '../../lib/zatca/qr'
import { enrichers, type ZatcaQrEnrichment } from '../enrichers'

const enricher = enrichers[0]

const RECORD = {
  id: 'order-1',
  grandTotalGrossAmount: '115.0000',
  taxTotalAmount: '15.0000',
  placedAt: '2026-01-31T09:15:00.000Z',
}

const SETTINGS = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
}

let settingsValue: unknown = SETTINGS
let getRecordCalls = 0

const container = {
  resolve: (name: string) => {
    if (name !== 'moduleConfigService') throw new Error(`Unexpected resolve: ${name}`)
    return {
      getRecord: async () => {
        getRecordCalls += 1
        if (settingsValue === null) return null
        return {
          moduleId: 'saudi_localization',
          name: 'vat',
          value: settingsValue,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          source: 'tenant',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      },
    }
  },
}

const context = {
  container,
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  em: undefined,
} as unknown as EnricherContext

const enrichmentOf = (result: Record<string, unknown>) => result._saudi_localization as ZatcaQrEnrichment['_saudi_localization']

describe('zatca invoice QR enricher', () => {
  beforeEach(() => {
    settingsValue = SETTINGS
    getRecordCalls = 0
  })

  it('targets the sales order surface and gates on the settings view feature', () => {
    expect(enricher.targetEntity).toBe('sales:sales_order')
    expect(enricher.features).toEqual(['saudi_localization.settings.view'])
    expect(enricher.cacheableOnListHit).toBe(false)
    expect(enricher.fallback).toEqual({
      _saudi_localization: { zatcaQrPayload: null, zatcaQrStatus: 'settings_incomplete' },
    })
  })

  it('attaches the payload the invoice QR needs and keeps the record intact', async () => {
    const result = await enricher.enrichOne(RECORD, context)

    expect(result.id).toBe('order-1')
    expect(enrichmentOf(result)).toEqual({
      zatcaQrPayload: buildZatcaQrPayload({
        sellerName: SETTINGS.sellerName,
        vatRegistrationNumber: SETTINGS.vatRegistrationNumber,
        issuedAt: '2026-01-31T09:15:00.000Z',
        invoiceTotalWithVat: '115.00',
        vatTotal: '15.00',
      }),
      zatcaQrStatus: 'ready',
    })
  })

  it('reports a disabled QR instead of omitting the field', async () => {
    settingsValue = { ...SETTINGS, invoiceQrEnabled: false }

    expect(enrichmentOf(await enricher.enrichOne(RECORD, context))).toEqual({
      zatcaQrPayload: null,
      zatcaQrStatus: 'qr_disabled',
    })
  })

  it('reports incomplete settings when the seller identity is not filled in', async () => {
    settingsValue = { ...SETTINGS, vatRegistrationNumber: '' }

    expect(enrichmentOf(await enricher.enrichOne(RECORD, context))).toEqual({
      zatcaQrPayload: null,
      zatcaQrStatus: 'settings_incomplete',
    })
  })

  it('reports incomplete settings when the settings store cannot be reached', async () => {
    settingsValue = null

    expect(enrichmentOf(await enricher.enrichOne(RECORD, context))).toEqual({
      zatcaQrPayload: null,
      zatcaQrStatus: 'settings_incomplete',
    })
  })

  it('reports missing invoice data rather than a half-built payload', async () => {
    expect(enrichmentOf(await enricher.enrichOne({ ...RECORD, taxTotalAmount: null }, context))).toEqual({
      zatcaQrPayload: null,
      zatcaQrStatus: 'missing_invoice_data',
    })
    expect(enrichmentOf(await enricher.enrichOne({ ...RECORD, placedAt: null, createdAt: null }, context))).toEqual({
      zatcaQrPayload: null,
      zatcaQrStatus: 'missing_invoice_data',
    })
  })

  it('reads the settings once for a batch and reports each record', async () => {
    const second = { ...RECORD, id: 'order-2', placedAt: '2026-02-02T09:00:00.000Z' }

    const results = await enricher.enrichMany!([RECORD, second], context)

    expect(getRecordCalls).toBe(1)
    expect(results).toHaveLength(2)
    expect(enrichmentOf(results[0]).zatcaQrStatus).toBe('ready')
    expect(enrichmentOf(results[1]).zatcaQrPayload).toBe(
      buildZatcaQrPayload({
        sellerName: SETTINGS.sellerName,
        vatRegistrationNumber: SETTINGS.vatRegistrationNumber,
        issuedAt: '2026-02-02T09:00:00.000Z',
        invoiceTotalWithVat: '115.00',
        vatTotal: '15.00',
      }),
    )
  })

  it('encodes an Arabic seller name from the settings', async () => {
    settingsValue = { ...SETTINGS, sellerName: 'شركة القمة' }

    const result = await enricher.enrichOne(RECORD, context)

    expect(enrichmentOf(result).zatcaQrPayload).toBe(
      buildZatcaQrPayload({
        sellerName: 'شركة القمة',
        vatRegistrationNumber: SETTINGS.vatRegistrationNumber,
        issuedAt: '2026-01-31T09:15:00.000Z',
        invoiceTotalWithVat: '115.00',
        vatTotal: '15.00',
      }),
    )
  })
})
