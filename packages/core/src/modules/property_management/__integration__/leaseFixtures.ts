import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  createBuilding,
  createUnit,
  createUnitProducts,
  deleteBuildingIfExists,
  deleteUnitProducts,
  listFloors,
  listSpaces,
  type UnitProductFixture,
} from './helpers'

export const SALES_OPERATION_QUEUE = 'property_management.sales_operation'
export const LEASE_SWEEP_QUEUE = 'property_management.lease_sweep'
export const SALES_PHASES_SKIP_REASON = 'requires sales recurring orders Phases 2–3'

export type JsonRecord = Record<string, unknown>

export type SettingsBody = {
  billingChannelId: string | null
  cancelledOrderStatusEntryId: string | null
  leaseEndingThresholdDays: number
  bookingReminderMinutes: number
  proposalExpiryDays: number
}

export type LeaseDetail = {
  lease: JsonRecord & { id: string; status: string; startsOn: string; endsOn: string; termMonths: number; salesOrderId: string | null }
  pendingChange: JsonRecord | null
  lastBillingRefusal: JsonRecord | null
  versions: Array<JsonRecord & { id: string; event: string; state: string; startsOn: string; endsOn: string; salesOrderId: string | null }>
  proposals: Array<JsonRecord & { id: string; kind: string; status: string; salesQuoteId: string | null; startsOn: string; endsOn: string }>
  operations: Array<JsonRecord & { id: string; kind: string; status: string }>
}

export type LeaseSetup = {
  channelId: string | null
  priceKindId: string | null
  products: UnitProductFixture | null
  buildingId: string | null
  unitIds: string[]
  companyIds: string[]
  leaseIds: string[]
  originalSettings: SettingsBody | null
}

export const MONTHLY_RATE = 1250

export function isoDayFromToday(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function postForId(request: APIRequestContext, token: string, path: string, data: JsonRecord, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `${label}: POST ${path} → ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return expectId(body?.id, `${label} id`)
}

export async function readSettings(request: APIRequestContext, token: string): Promise<SettingsBody> {
  const response = await apiRequest(request, 'GET', '/api/property_management/settings', { token })
  expect(response.status(), 'GET settings should return 200').toBe(200)
  const body = (await readJsonSafe<SettingsBody>(response)) as SettingsBody
  return {
    billingChannelId: body.billingChannelId,
    cancelledOrderStatusEntryId: body.cancelledOrderStatusEntryId,
    leaseEndingThresholdDays: body.leaseEndingThresholdDays,
    bookingReminderMinutes: body.bookingReminderMinutes,
    proposalExpiryDays: body.proposalExpiryDays,
  }
}

export async function saveSettings(request: APIRequestContext, token: string, data: SettingsBody) {
  return apiRequest(request, 'PUT', '/api/property_management/settings', { token, data })
}

export async function createSalesChannel(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  return postForId(request, token, '/api/sales/channels', { name: `QA PM channel ${stamp}`, code: `qa-pm-${stamp}`, isActive: true }, 'sales channel')
}

export async function createLeaseSetup(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: { units?: number; companies?: number; managerUserIds?: string[] } = {},
): Promise<LeaseSetup> {
  const setup: LeaseSetup = {
    channelId: null,
    priceKindId: null,
    products: null,
    buildingId: null,
    unitIds: [],
    companyIds: [],
    leaseIds: [],
    originalSettings: null,
  }
  setup.originalSettings = await readSettings(request, token)
  setup.channelId = await createSalesChannel(request, token, stamp)
  const saved = await saveSettings(request, token, { ...setup.originalSettings, billingChannelId: setup.channelId })
  expect(saved.status(), 'PUT settings with the QA channel should return 200').toBe(200)
  setup.priceKindId = await postForId(
    request,
    token,
    '/api/catalog/price-kinds',
    { code: `qa_pm_${stamp}`.replace(/-/g, '_'), title: `QA PM rent ${stamp}`, displayMode: 'excluding-tax' },
    'price kind',
  )
  setup.products = await createUnitProducts(request, token, stamp)
  for (const productId of [setup.products.productId, setup.products.secondProductId]) {
    await postForId(
      request,
      token,
      '/api/catalog/prices',
      { productId, priceKindId: setup.priceKindId, currencyCode: 'EUR', unitPriceNet: MONTHLY_RATE, unitPriceGross: MONTHLY_RATE },
      'price',
    )
  }
  setup.buildingId = await createBuilding(request, token, {
    name: `QA PM Leases ${stamp}`,
    size: { x: 40, y: 10 },
    managerUserIds: input.managerUserIds,
  })
  const [floor] = await listFloors(request, token, setup.buildingId)
  const [space] = await listSpaces(request, token, floor.id)
  const unitCount = input.units ?? 1
  for (let index = 0; index < unitCount; index += 1) {
    const response = await createUnit(request, token, {
      floorId: floor.id,
      spaceId: space.id,
      name: `Office ${index + 1} ${stamp}`,
      catalogCategoryId: setup.products.categoryId,
      catalogProductId: setup.products.productId,
      x: index * 5,
      y: 0,
      width: 4,
      depth: 4,
    })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), `POST units → ${JSON.stringify(body)}`).toBe(201)
    setup.unitIds.push(expectId(body?.id, 'Unit id'))
  }
  const companyCount = input.companies ?? 1
  for (let index = 0; index < companyCount; index += 1) {
    setup.companyIds.push(await createCompanyFixture(request, token, `QA PM Tenant ${index + 1} ${stamp}`))
  }
  return setup
}

export async function cleanupLeaseSetup(request: APIRequestContext, token: string | null, setup: LeaseSetup | null): Promise<void> {
  if (!token || !setup) return
  for (const leaseId of setup.leaseIds) await deleteLeaseIfExists(request, token, leaseId)
  if (setup.originalSettings) await saveSettings(request, token, setup.originalSettings).catch(() => undefined)
  await deleteBuildingIfExists(request, token, setup.buildingId)
  await deleteUnitProducts(request, token, setup.products)
  if (setup.priceKindId) await deleteEntityIfExists(request, token, '/api/catalog/price-kinds', setup.priceKindId)
  for (const companyId of setup.companyIds) await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  if (setup.channelId) await deleteEntityIfExists(request, token, '/api/sales/channels', setup.channelId)
}

export async function deleteLeaseIfExists(request: APIRequestContext, token: string | null, leaseId: string | null): Promise<void> {
  if (!token || !leaseId) return
  await apiRequest(request, 'DELETE', `/api/property_management/leases?id=${encodeURIComponent(leaseId)}`, { token }).catch(() => undefined)
}

export type LeaseCreateInput = {
  unitId: string
  customerCompanyId: string
  startsOn: string
  termMonths: number
  monthlyRate?: number
  asProposal?: boolean
  expiresInDays?: number
  primaryContactPersonId?: string
}

export async function postLease(request: APIRequestContext, token: string, input: LeaseCreateInput) {
  return apiRequest(request, 'POST', '/api/property_management/leases', {
    token,
    data: { monthlyRate: MONTHLY_RATE, asProposal: false, ...input },
  })
}

export async function createLease(
  request: APIRequestContext,
  token: string,
  setup: LeaseSetup,
  input: LeaseCreateInput,
): Promise<{ id: string; proposalId: string | null; status: string }> {
  const response = await postLease(request, token, input)
  const body = await readJsonSafe<{ id?: string; proposalId?: string | null; status?: string }>(response)
  expect(response.status(), `POST leases → ${JSON.stringify(body)}`).toBe(202)
  const id = expectId(body?.id, 'Lease id')
  setup.leaseIds.push(id)
  return { id, proposalId: body?.proposalId ?? null, status: body?.status ?? '' }
}

export async function readLease(request: APIRequestContext, token: string, leaseId: string): Promise<LeaseDetail | null> {
  const response = await apiRequest(request, 'GET', `/api/property_management/leases/${leaseId}`, { token })
  if (response.status() !== 200) return null
  return readJsonSafe<LeaseDetail>(response)
}

export async function drainSalesOperations(): Promise<void> {
  await drainIntegrationQueue(SALES_OPERATION_QUEUE).catch(() => 0)
}

export async function waitForLease(
  request: APIRequestContext,
  token: string,
  leaseId: string,
  settled: (detail: LeaseDetail) => boolean,
  attempts = 30,
): Promise<LeaseDetail | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const detail = await readLease(request, token, leaseId)
    if (detail && settled(detail)) return detail
    if (attempt === Math.floor(attempts / 3)) await drainSalesOperations()
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

export function isActivated(detail: LeaseDetail): boolean {
  return detail.lease.status !== 'pending_order'
}

export function proposalSent(proposalId: string) {
  return (detail: LeaseDetail): boolean => detail.proposals.some((proposal) => proposal.id === proposalId && proposal.status !== 'sending')
}

export async function readSalesDocument(request: APIRequestContext, token: string, resource: 'orders' | 'quotes', id: string): Promise<JsonRecord | null> {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  if (response.status() !== 200) return null
  const body = await readJsonSafe<{ items?: JsonRecord[] }>(response)
  return body?.items?.[0] ?? null
}

export async function readDocumentLines(request: APIRequestContext, token: string, resource: 'order' | 'quote', documentId: string): Promise<JsonRecord[]> {
  const path = resource === 'order' ? `/api/sales/order-lines?orderId=${documentId}` : `/api/sales/quote-lines?quoteId=${documentId}`
  const response = await apiRequest(request, 'GET', path, { token })
  if (response.status() !== 200) return []
  const body = await readJsonSafe<{ items?: JsonRecord[] }>(response)
  return body?.items ?? []
}

export function readField(record: JsonRecord | null | undefined, ...keys: string[]): unknown {
  if (!record) return undefined
  for (const key of keys) if (record[key] !== undefined) return record[key]
  return undefined
}

export async function salesRecurrenceSurfaceAvailable(request: APIRequestContext, token: string, orderId: string | null): Promise<boolean> {
  if (!orderId) return false
  const response = await apiRequest(request, 'GET', `/api/sales/orders/${orderId}/recurrence`, { token })
  return response.status() !== 404
}

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')
const QUEUE_BASE_DIR = process.env.QUEUE_BASE_DIR?.trim() || path.resolve(APP_ROOT, '.mercato/queue')

async function readCompletedCount(queueName: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(QUEUE_BASE_DIR, queueName, 'state.json'), 'utf8')
    const parsed = JSON.parse(raw) as { completedCount?: unknown }
    return typeof parsed.completedCount === 'number' ? parsed.completedCount : 0
  } catch {
    return 0
  }
}

export async function runLeaseSweep(scope: { tenantId: string; organizationId: string }): Promise<boolean> {
  const before = await readCompletedCount(LEASE_SWEEP_QUEUE)
  const queue = createQueue<{ scope: { tenantId: string; organizationId: string } }>(LEASE_SWEEP_QUEUE, 'local', {
    baseDir: QUEUE_BASE_DIR,
    concurrency: 1,
  })
  try {
    await queue.enqueue({ scope })
  } finally {
    await queue.close()
  }
  const processed = await drainIntegrationQueue(LEASE_SWEEP_QUEUE, { appRoot: APP_ROOT }).catch(() => 0)
  if (processed > 0) return true
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await readCompletedCount(LEASE_SWEEP_QUEUE)) > before) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}
