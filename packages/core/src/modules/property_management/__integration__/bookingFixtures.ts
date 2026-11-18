import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCategoryFixture, deleteCatalogCategoryIfExists, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createBuilding, createProductInCategory, createUnit, deleteBuildingIfExists, listFloors, listSpaces, setProductUse } from './helpers'
import {
  createSalesChannel,
  describeSalesOperations,
  drainSalesOperations,
  isoDayFromToday,
  pollWithDrain,
  readSettings,
  restoreSettings,
  saveSettings,
  SALES_OPERATION_QUEUE,
  settingsReleased,
  skipOrFailUnsettled,
  type SettingsBody,
} from './leaseFixtures'
import { deleteChannelOrders } from './salesFixtures'

export const HOURLY_PRICE = 50
export const SECOND_HOURLY_PRICE = 80

export type BookingSetup = {
  channelId: string | null
  priceKindId: string | null
  categoryId: string | null
  productId: string | null
  secondProductId: string | null
  cancelledStatusEntryId: string | null
  createdStatusEntryId: string | null
  buildingId: string | null
  unitIds: string[]
  companyId: string | null
  personId: string | null
  bookingIds: string[]
  originalSettings: SettingsBody | null
}

export type BookingRow = {
  id: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'
  unitId: string
  buildingId: string
  startsAt: string
  endsAt: string
  productName: string
  unitPrice: string
  quantity: number
  totalAmount: string
  currencyCode: string | null
  cancelReason: string | null
  customerUserId: string | null
  salesOrderId: string | null
  salesOrderNumber: string | null
  salesOrderCancelled: boolean
  updatedAt: string
}

async function postForId(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `${label}: POST ${path} → ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.id, `${label} id`)
}

async function resolveCancelledStatus(request: APIRequestContext, token: string, stamp: string): Promise<{ id: string; created: boolean }> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?pageSize=100', { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; value: string }> }>(response)
  const existing = (body?.items ?? []).find((item) => item.value === 'canceled' || item.value === 'cancelled')
  if (existing) return { id: existing.id, created: false }
  const id = await postForId(request, token, '/api/sales/order-statuses', { value: `qa-pm-cancelled-${stamp}`, label: `QA PM cancelled ${stamp}` }, 'order status')
  return { id, created: true }
}

export function bookingDay(offsetDays = 2): string {
  return isoDayFromToday(offsetDays)
}

export async function createBookingSetup(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: { units?: number; managerUserIds?: string[] } = {},
): Promise<BookingSetup> {
  const setup: BookingSetup = {
    channelId: null,
    priceKindId: null,
    categoryId: null,
    productId: null,
    secondProductId: null,
    cancelledStatusEntryId: null,
    createdStatusEntryId: null,
    buildingId: null,
    unitIds: [],
    companyId: null,
    personId: null,
    bookingIds: [],
    originalSettings: null,
  }
  try {
    await populateBookingSetup(request, token, stamp, input, setup)
  } catch (error) {
    await cleanupBookingSetup(request, token, setup).catch(() => undefined)
    throw error
  }
  return setup
}

async function populateBookingSetup(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: { units?: number; managerUserIds?: string[] },
  setup: BookingSetup,
): Promise<void> {
  setup.originalSettings = await readSettings(request, token)
  setup.channelId = await createSalesChannel(request, token, stamp)
  const cancelled = await resolveCancelledStatus(request, token, stamp)
  setup.cancelledStatusEntryId = cancelled.id
  if (cancelled.created) setup.createdStatusEntryId = cancelled.id
  const saved = await saveSettings(request, token, {
    ...setup.originalSettings,
    billingChannelId: setup.channelId,
    cancelledOrderStatusEntryId: setup.cancelledStatusEntryId,
  })
  expect(saved.status(), 'PUT settings with the QA channel and cancelled status should return 200').toBe(200)
  setup.priceKindId = await postForId(
    request,
    token,
    '/api/catalog/price-kinds',
    { code: `qa_pm_bk_${stamp}`.replace(/-/g, '_'), title: `QA PM booking ${stamp}`, displayMode: 'excluding-tax' },
    'price kind',
  )
  setup.categoryId = await createCategoryFixture(request, token, { name: `QA PM rooms ${stamp}` })
  setup.productId = await createProductInCategory(request, token, { title: `QA PM meeting room ${stamp}`, sku: `QA-PM-MR-${stamp}`, categoryId: setup.categoryId })
  setup.secondProductId = await createProductInCategory(request, token, { title: `QA PM board room ${stamp}`, sku: `QA-PM-BR-${stamp}`, categoryId: setup.categoryId })
  for (const [productId, price] of [[setup.productId, HOURLY_PRICE], [setup.secondProductId, SECOND_HOURLY_PRICE]] as const) {
    const use = await setProductUse(request, token, productId, 'bookable', 'hour')
    expect(use.status(), 'POST product-uses (bookable) should return 201').toBe(201)
    await postForId(
      request,
      token,
      '/api/catalog/prices',
      { productId, priceKindId: setup.priceKindId, currencyCode: 'EUR', unitPriceNet: price, unitPriceGross: price },
      'price',
    )
  }
  setup.buildingId = await createBuilding(request, token, { name: `QA PM Bookings ${stamp}`, size: { x: 40, y: 10 }, managerUserIds: input.managerUserIds })
  const [floor] = await listFloors(request, token, setup.buildingId)
  const [space] = await listSpaces(request, token, floor.id)
  for (let index = 0; index < (input.units ?? 1); index += 1) {
    const response = await createUnit(request, token, {
      floorId: floor.id,
      spaceId: space.id,
      name: `Room ${index + 1} ${stamp}`,
      catalogCategoryId: setup.categoryId,
      catalogProductId: setup.productId,
      x: index * 5,
      y: 0,
      width: 4,
      depth: 4,
    })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), `POST units → ${JSON.stringify(body)}`).toBe(201)
    setup.unitIds.push(expectId(body?.id, 'Unit id'))
  }
  setup.companyId = await createCompanyFixture(request, token, `QA PM Member Co ${stamp}`)
  setup.personId = await createPersonFixture(request, token, {
    firstName: 'Marta',
    lastName: `Booker ${stamp}`,
    displayName: `Marta Booker ${stamp}`,
    companyEntityId: setup.companyId,
  })
}

export async function cleanupBookingSetup(request: APIRequestContext, token: string | null, setup: BookingSetup | null): Promise<void> {
  if (!token || !setup) return
  for (const bookingId of setup.bookingIds) await cancelBooking(request, token, bookingId).catch(() => undefined)
  await drainSalesOperations()
  const restore = await restoreSettings(request, token, setup.originalSettings)
  await deleteBuildingIfExists(request, token, setup.buildingId, { productIds: [setup.productId, setup.secondProductId] })
  const ordersCleared = await deleteChannelOrders(request, token, setup.channelId)
  for (const productId of [setup.productId, setup.secondProductId]) {
    if (!productId) continue
    await setProductUse(request, token, productId, null, null).catch(() => undefined)
    await deleteCatalogProductIfExists(request, token, productId)
  }
  await deleteCatalogCategoryIfExists(request, token, setup.categoryId)
  if (setup.priceKindId) await deleteEntityIfExists(request, token, '/api/catalog/price-kinds', setup.priceKindId)
  if (setup.personId) await deleteEntityIfExists(request, token, '/api/customers/people', setup.personId)
  if (setup.companyId) await deleteEntityIfExists(request, token, '/api/customers/companies', setup.companyId)
  if (setup.createdStatusEntryId && ordersCleared && settingsReleased(restore, { statusEntryId: setup.createdStatusEntryId })) {
    await deleteEntityIfExists(request, token, '/api/sales/order-statuses', setup.createdStatusEntryId)
  }
  if (setup.channelId && ordersCleared && settingsReleased(restore, { channelId: setup.channelId })) {
    await deleteEntityIfExists(request, token, '/api/sales/channels', setup.channelId)
  }
  if (restore.failure) throw new Error(`[internal] ${restore.failure}; the QA sales channel ${setup.channelId} was kept`)
}

export type BookingInput = {
  unitId: string
  startsAt: string
  endsAt: string
  bookedByPersonId: string
  customerCompanyId?: string | null
  customerUserId?: string | null
  notes?: string | null
}

export async function postBooking(request: APIRequestContext, token: string, input: BookingInput) {
  return apiRequest(request, 'POST', '/api/property_management/bookings', { token, data: input })
}

export async function createBooking(request: APIRequestContext, token: string, setup: BookingSetup, input: BookingInput): Promise<string> {
  const response = await postBooking(request, token, input)
  const body = await readJsonSafe<{ id?: string; status?: string }>(response)
  if (typeof body?.id === 'string' && body.id) setup.bookingIds.push(body.id)
  expect(response.status(), `POST bookings → ${JSON.stringify(body)}`).toBe(202)
  expect(body?.status).toBe('pending')
  return expectId(body?.id, 'Booking id')
}

export async function cancelBooking(request: APIRequestContext, token: string, bookingId: string) {
  return apiRequest(request, 'POST', `/api/property_management/bookings/${bookingId}/cancel`, { token })
}

export async function readBooking(request: APIRequestContext, token: string, bookingId: string): Promise<BookingRow | null> {
  const response = await apiRequest(request, 'GET', `/api/property_management/bookings?id=${encodeURIComponent(bookingId)}`, { token })
  if (response.status() !== 200) return null
  const body = await readJsonSafe<{ items?: BookingRow[] }>(response)
  return body?.items?.[0] ?? null
}

export async function waitForBooking(
  request: APIRequestContext,
  token: string,
  bookingId: string,
  settled: (booking: BookingRow) => boolean,
  attempts = 30,
): Promise<BookingRow | null> {
  return (await pollWithDrain(() => readBooking(request, token, bookingId), settled, attempts)).value
}

export async function settleBooking(
  request: APIRequestContext,
  token: string,
  bookingId: string,
  settled: (booking: BookingRow) => boolean,
  label: string,
  attempts = 30,
): Promise<BookingRow> {
  const poll = await pollWithDrain(() => readBooking(request, token, bookingId), settled, attempts)
  if (poll.value) return poll.value
  const state = poll.last
    ? `booking ${poll.last.status}, salesOrderId ${poll.last.salesOrderId ?? 'none'}, cancelReason ${poll.last.cancelReason ?? 'none'}`
    : 'booking unreadable'
  const operations = await describeSalesOperations(token, bookingId)
  return skipOrFailUnsettled(SALES_OPERATION_QUEUE, poll.drain, `${label} did not settle although the ${SALES_OPERATION_QUEUE} queue drained: ${state}; operations: ${operations}`)
}

export function isConfirmed(booking: BookingRow): boolean {
  return booking.status === 'confirmed' && Boolean(booking.salesOrderId)
}
