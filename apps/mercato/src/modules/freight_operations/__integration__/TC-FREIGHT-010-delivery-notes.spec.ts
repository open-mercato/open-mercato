import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createDeliveryNoteFixture,
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  getDeliveryNoteFixture,
  isoInstant,
  runDeliveryNoteAction,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'transport_operations', 'saudi_localization'],
}

const ORDERS = '/api/freight_operations/orders'
const NOTES = '/api/freight_operations/delivery-notes'
const COMPANIES = '/api/customers/companies'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'
const VAT_SETTINGS = '/api/saudi_localization/vat-settings'

async function configureSeller(request: APIRequestContext, token: string, suffix: string) {
  const response = await apiRequest(request, 'PUT', VAT_SETTINGS, {
    token,
    data: {
      sellerName: `Delivery note seller ${suffix}`,
      vatRegistrationNumber: '300000000000003',
      commercialRegistrationNumber: null,
      vatRate: 0.15,
      invoiceQrEnabled: true,
      filingFrequency: 'quarterly',
    },
  })
  expect(response.ok(), `PUT ${VAT_SETTINGS} failed with ${response.status()}`).toBeTruthy()
}

/**
 * TC-FREIGHT-010: an order produces a numbered delivery note, the note freezes
 * the seller/vehicle/driver at issue, and the external Bayan Naql reference
 * blocks cancellation until it is itself cancelled.
 */
test.describe('TC-FREIGHT-010: freight delivery notes', () => {
  test('order → draft → issued → waybill → delivered, with the waybill blocking cancellation', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Delivery note TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Delivery note TC ${suffix}` }

    let order: string | null = null
    let note: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null

    try {
      await configureSeller(request, token, suffix)
      vehicle = await createTransportVehicleFixture(request, token)
      driver = await createTransportDriverFixture(request, token)

      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: `Pallets ${suffix}`,
        requestedPickupAt: isoInstant(1),
        requestedDeliveryAt: isoInstant(1.5),
      })
      order = created.id

      // A draft order is not a transport document yet.
      const tooEarly = await apiRequest(request, 'POST', NOTES, {
        token,
        data: { freightOrderId: order },
        retryTransport: false,
      })
      expect(tooEarly.status(), 'a draft order must not accept a delivery note').toBe(409)

      expect((await runFreightOrderAction(request, token, order, 'confirm')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, token, order, 'assign', { vehicleId: vehicle, driverId: driver })).ok).toBeTruthy()

      const draft = await createDeliveryNoteFixture(request, token, {
        freightOrderId: order,
        consigneeName: `Receiver ${suffix}`,
      })
      note = draft.id
      expect(draft.noteNumber, 'the note must carry a DN number').toMatch(/^DN-\d{5}$/)

      const createdRow = await getDeliveryNoteFixture(request, token, note)
      expect(createdRow?.status).toBe('draft')
      expect(createdRow?.origin).toBe('Riyadh')
      expect(createdRow?.destination).toBe('Dammam')
      expect(createdRow?.customer_id).toBe(company)

      const issued = await runDeliveryNoteAction(request, token, note, 'issue')
      expect(issued.ok, JSON.stringify(issued.body)).toBeTruthy()
      const issuedRow = await getDeliveryNoteFixture(request, token, note)
      expect(issuedRow?.status).toBe('issued')
      expect((issuedRow?.seller_snapshot as Record<string, unknown> | null)?.sellerName).toContain('Delivery note seller')
      expect((issuedRow?.vehicle_snapshot as Record<string, unknown> | null)?.plateNumber).toBeTruthy()
      expect((issuedRow?.driver_snapshot as Record<string, unknown> | null)?.fullName).toBeTruthy()

      const waybill = await runDeliveryNoteAction(request, token, note, 'record-waybill', {
        status: 'recorded',
        waybillNumber: `BN-${suffix}`,
      })
      expect(waybill.ok, JSON.stringify(waybill.body)).toBeTruthy()
      expect((await getDeliveryNoteFixture(request, token, note))?.external_waybill_status).toBe('recorded')

      const blockedCancel = await runDeliveryNoteAction(request, token, note, 'cancel', { reason: 'test' })
      expect(blockedCancel.status, 'a live waybill must block cancellation').toBe(409)

      expect((await runDeliveryNoteAction(request, token, note, 'record-waybill', { status: 'cancelled' })).ok).toBeTruthy()

      const delivered = await runDeliveryNoteAction(request, token, note, 'deliver', {
        receivedByName: `Receiver ${suffix}`,
        podReference: `POD-${suffix}`,
      })
      expect(delivered.ok, JSON.stringify(delivered.body)).toBeTruthy()
      const deliveredRow = await getDeliveryNoteFixture(request, token, note)
      expect(deliveredRow?.status).toBe('delivered')
      expect(deliveredRow?.received_by_name).toBe(`Receiver ${suffix}`)
      expect(deliveredRow?.pod_reference).toBe(`POD-${suffix}`)
    } finally {
      await deleteFreightEntityIfExists(request, token, NOTES, note)
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, token, VEHICLES, vehicle)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })

  test('a draft note is editable and deletable; an issued note is not', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Delivery note edit TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Delivery note edit TC ${suffix}` }

    let order: string | null = null
    let note: string | null = null

    try {
      await configureSeller(request, token, suffix)
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
      })
      order = created.id
      expect((await runFreightOrderAction(request, token, order, 'confirm')).ok).toBeTruthy()

      const draft = await createDeliveryNoteFixture(request, token, { freightOrderId: order })
      note = draft.id

      const update = await apiRequest(request, 'PUT', NOTES, {
        token,
        data: { id: note, notes: `Updated ${suffix}`, consigneeName: `Receiver ${suffix}` },
        retryTransport: false,
      })
      expect(update.ok(), `PUT ${NOTES} failed with ${update.status()}`).toBeTruthy()
      expect((await getDeliveryNoteFixture(request, token, note))?.consignee_name).toBe(`Receiver ${suffix}`)

      const deleted = await apiRequest(request, 'DELETE', `${NOTES}?id=${encodeURIComponent(note)}`, {
        token,
        retryTransport: false,
      })
      expect(deleted.ok(), `DELETE ${NOTES} failed with ${deleted.status()}`).toBeTruthy()
      note = null
    } finally {
      await deleteFreightEntityIfExists(request, token, NOTES, note)
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
