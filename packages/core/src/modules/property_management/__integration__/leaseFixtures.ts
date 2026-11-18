import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCategoryFixture, deleteCatalogCategoryIfExists, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  createBuilding,
  createProductInCategory,
  createUnit,
  deleteBuildingIfExists,
  listFloors,
  listSpaces,
  setProductUse,
} from './helpers'
import { deleteChannelSalesDocuments } from './salesFixtures'
import { buildPendingChange, previousTermOf } from '../lib/pendingChange'
import type { LeaseStatus } from '../data/entities'

export const SALES_OPERATION_QUEUE = 'property_management.sales_operation'
export const LEASE_SWEEP_QUEUE = 'property_management.lease_sweep'
export const SALES_PHASES_SKIP_REASON = 'requires sales recurring orders Phases 2–3'
export const SALES_CANCEL_SKIP_REASON = 'sales cannot cancel recurring orders yet (sales recurring orders Phases 2–3), so the end or delete is refused with lease_billing_cancel_unavailable'

export function salesCancelUnavailable(detail: LeaseDetail | null): boolean {
  return detail?.salesCancelAvailable === false
}

export async function expectBillingCancelRefused(response: APIResponse): Promise<void> {
  const body = await readJsonSafe<{ code?: string }>(response)
  expect(response.status(), JSON.stringify(body)).toBe(409)
  expect(body?.code).toBe('lease_billing_cancel_unavailable')
}

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
  salesCancelAvailable?: boolean
}

export type LeaseProducts = { categoryId: string | null; productId: string | null; secondProductId: string | null }

export type LeaseSetup = {
  channelId: string | null
  priceKindId: string | null
  products: LeaseProducts
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

export type SettingsRestore = { current: SettingsBody | null; failure: string | null }

export async function restoreSettings(request: APIRequestContext, token: string, original: SettingsBody | null): Promise<SettingsRestore> {
  if (!original) return { current: null, failure: null }
  const saved = await saveSettings(request, token, original).catch(() => null)
  if (saved?.status() !== 200) {
    const body = saved ? await readJsonSafe(saved) : null
    return { current: null, failure: `restoring the property_management settings → ${saved?.status() ?? 'no response'} ${JSON.stringify(body)}` }
  }
  const response = await apiRequest(request, 'GET', '/api/property_management/settings', { token }).catch(() => null)
  const current = response?.status() === 200 ? await readJsonSafe<SettingsBody>(response) : null
  if (!current) return { current: null, failure: `re-reading the restored property_management settings → ${response?.status() ?? 'no response'}` }
  return { current, failure: null }
}

export function settingsReleased(restore: SettingsRestore, ids: { channelId?: string | null; statusEntryId?: string | null }): boolean {
  const current = restore.current
  if (!current) return false
  if (ids.channelId && current.billingChannelId === ids.channelId) return false
  if (ids.statusEntryId && current.cancelledOrderStatusEntryId === ids.statusEntryId) return false
  return true
}

export async function createSalesChannel(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  return postForId(request, token, '/api/sales/channels', { name: `QA PM channel ${stamp}`, code: `qa-pm-${stamp}`, isActive: true }, 'sales channel')
}

export type LeaseSetupInput = {
  units?: number
  companies?: number
  managerUserIds?: string[]
  buildingName?: string
  unitName?: (index: number) => string
}

export async function createLeaseSetup(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: LeaseSetupInput = {},
): Promise<LeaseSetup> {
  const setup: LeaseSetup = {
    channelId: null,
    priceKindId: null,
    products: { categoryId: null, productId: null, secondProductId: null },
    buildingId: null,
    unitIds: [],
    companyIds: [],
    leaseIds: [],
    originalSettings: null,
  }
  try {
    await populateLeaseSetup(request, token, stamp, input, setup)
  } catch (error) {
    await cleanupLeaseSetup(request, token, setup).catch(() => undefined)
    throw error
  }
  return setup
}

async function populateLeaseSetup(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: LeaseSetupInput,
  setup: LeaseSetup,
): Promise<void> {
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
  const categoryId = await createCategoryFixture(request, token, { name: `QA PM offices ${stamp}` })
  setup.products.categoryId = categoryId
  const productId = await createProductInCategory(request, token, { title: `QA PM office ${stamp}`, sku: `QA-PM-OFF-${stamp}`, categoryId })
  setup.products.productId = productId
  const secondProductId = await createProductInCategory(request, token, { title: `QA PM big office ${stamp}`, sku: `QA-PM-BIG-${stamp}`, categoryId })
  setup.products.secondProductId = secondProductId
  for (const id of [productId, secondProductId]) {
    const use = await setProductUse(request, token, id, 'leasable', 'month')
    expect(use.status(), 'POST product-uses should return 201').toBe(201)
  }
  for (const id of [productId, secondProductId]) {
    await postForId(
      request,
      token,
      '/api/catalog/prices',
      { productId: id, priceKindId: setup.priceKindId, currencyCode: 'EUR', unitPriceNet: MONTHLY_RATE, unitPriceGross: MONTHLY_RATE },
      'price',
    )
  }
  setup.buildingId = await createBuilding(request, token, {
    name: input.buildingName ?? `QA PM Leases ${stamp}`,
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
      name: input.unitName ? input.unitName(index) : `Office ${index + 1} ${stamp}`,
      catalogCategoryId: categoryId,
      catalogProductId: productId,
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
}

export async function cleanupLeaseSetup(request: APIRequestContext, token: string | null, setup: LeaseSetup | null): Promise<void> {
  if (!token || !setup) return
  for (const leaseId of setup.leaseIds) await deleteLeaseIfExists(request, token, leaseId)
  if (setup.leaseIds.length) await drainSalesOperations()
  const restore = await restoreSettings(request, token, setup.originalSettings)
  const productIds = [setup.products.productId, setup.products.secondProductId]
  await deleteBuildingIfExists(request, token, setup.buildingId, { productIds })
  const ordersCleared = await deleteChannelSalesDocuments(request, token, 'orders', setup.channelId)
  const quotesCleared = await deleteChannelSalesDocuments(request, token, 'quotes', setup.channelId)
  for (const productId of productIds) {
    if (!productId) continue
    await setProductUse(request, token, productId, null, null).catch(() => undefined)
    await deleteCatalogProductIfExists(request, token, productId)
  }
  await deleteCatalogCategoryIfExists(request, token, setup.products.categoryId)
  if (setup.priceKindId) await deleteEntityIfExists(request, token, '/api/catalog/price-kinds', setup.priceKindId)
  for (const companyId of setup.companyIds) await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  if (setup.channelId && ordersCleared && quotesCleared && settingsReleased(restore, { channelId: setup.channelId })) {
    await deleteEntityIfExists(request, token, '/api/sales/channels', setup.channelId)
  }
  if (restore.failure) throw new Error(`[internal] ${restore.failure}; the QA sales channel ${setup.channelId} was kept`)
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
  if (typeof body?.id === 'string' && body.id) setup.leaseIds.push(body.id)
  expect(response.status(), `POST leases → ${JSON.stringify(body)}`).toBe(202)
  const id = expectId(body?.id, 'Lease id')
  return { id, proposalId: body?.proposalId ?? null, status: body?.status ?? '' }
}

export async function readLease(request: APIRequestContext, token: string, leaseId: string): Promise<LeaseDetail | null> {
  const response = await apiRequest(request, 'GET', `/api/property_management/leases/${leaseId}`, { token })
  if (response.status() !== 200) return null
  return readJsonSafe<LeaseDetail>(response)
}

/**
 * Outcome of one `drainIntegrationQueue` call. `ran: false` means the helper itself threw: it could
 * not observe or run the queue in this environment (no worker consumed the managed queue, the queue
 * state is unreadable, or the app-process drain could not start). Only that case may skip a
 * worker-dependent test; a drain that ran and still left the record unsettled is a failure.
 */
export type QueueDrain = { ran: true; processed: number } | { ran: false; reason: string }

export type DrainedPoll<T> = { value: T | null; last: T | null; drain: QueueDrain | null }

function firstLineOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const line = message.split(/\r?\n/).find((entry) => entry.trim().length > 0)
  return line ? line.trim().slice(0, 300) : 'unknown error'
}

export async function drainQueue(queueName: string): Promise<QueueDrain> {
  try {
    return { ran: true, processed: await drainIntegrationQueue(queueName, { appRoot: APP_ROOT }) }
  } catch (error) {
    return { ran: false, reason: firstLineOf(error) }
  }
}

export async function drainSalesOperations(): Promise<QueueDrain> {
  return drainQueue(SALES_OPERATION_QUEUE)
}

function runsInCi(): boolean {
  const value = process.env.CI?.trim()
  if (!value) return false
  return parseBooleanToken(value) ?? true
}

export function workersRequired(): boolean {
  return parseBooleanWithDefault(process.env.OM_PM_REQUIRE_WORKERS, runsInCi())
}

export function skipOrFailUnsettled(queueName: string, drain: QueueDrain | null, failure: string): never {
  if (drain && !drain.ran) {
    const reason = `the ${queueName} queue cannot be drained in this environment: ${drain.reason}`
    if (workersRequired()) throw new Error(`[internal] ${failure}; ${reason} (workers are required: OM_PM_REQUIRE_WORKERS is set or CI runs; OM_PM_REQUIRE_WORKERS=0 skips instead)`)
    test.skip(true, reason)
  }
  throw new Error(`[internal] ${failure}`)
}

export async function pollWithDrain<T>(
  read: () => Promise<T | null>,
  settled: (value: T) => boolean,
  attempts = 30,
): Promise<DrainedPoll<T>> {
  let last: T | null = null
  let drain: QueueDrain | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await read()
    if (last && settled(last)) return { value: last, last, drain }
    if (attempt === Math.floor(attempts / 3)) drain = await drainSalesOperations()
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { value: null, last, drain }
}

type SalesOperationRow = { kind: string; status: string; attempts: number; last_error: unknown }

export async function describeSalesOperations(token: string, subjectId: string): Promise<string> {
  const scope = getTokenContext(token)
  try {
    const rows = await withClient(async (client) => {
      const result = await client.query<SalesOperationRow>(
        'select kind, status, attempts, last_error from property_management_sales_operations where organization_id = $1 and tenant_id = $2 and (target_id = $3 or lease_id = $3) order by created_at',
        [scope.organizationId, scope.tenantId, subjectId],
      )
      return result.rows
    })
    if (!rows.length) return 'no sales operation recorded'
    return rows
      .map((row) => `${row.kind} ${row.status} after ${row.attempts} attempt(s), lastError ${JSON.stringify(row.last_error ?? null)}`)
      .join('; ')
  } catch (error) {
    return `sales operations unreadable (${firstLineOf(error)})`
  }
}

export async function waitForLease(
  request: APIRequestContext,
  token: string,
  leaseId: string,
  settled: (detail: LeaseDetail) => boolean,
  attempts = 30,
): Promise<DrainedPoll<LeaseDetail>> {
  return pollWithDrain(() => readLease(request, token, leaseId), settled, attempts)
}

export async function requireLease(token: string, leaseId: string, poll: DrainedPoll<LeaseDetail>, label: string): Promise<LeaseDetail> {
  if (poll.value) return poll.value
  const state = poll.last
    ? `lease ${poll.last.lease.status}, pendingChange ${JSON.stringify(poll.last.pendingChange)}, lastBillingRefusal ${JSON.stringify(poll.last.lastBillingRefusal)}`
    : 'lease unreadable'
  const operations = await describeSalesOperations(token, leaseId)
  return skipOrFailUnsettled(SALES_OPERATION_QUEUE, poll.drain, `${label} did not settle although the ${SALES_OPERATION_QUEUE} queue drained: ${state}; operations: ${operations}`)
}

export async function settleLease(
  request: APIRequestContext,
  token: string,
  leaseId: string,
  settled: (detail: LeaseDetail) => boolean,
  label: string,
  attempts = 30,
): Promise<LeaseDetail> {
  return requireLease(token, leaseId, await waitForLease(request, token, leaseId, settled, attempts), label)
}

/**
 * Pins a pending end on an active lease straight in the database, under its own change id, so no
 * sales operation can settle or revert it: `ends_on` moves to `endsOn` and `pending_change` is built
 * by the same serializer `POST leases/{id}/end` uses (`lib/pendingChange`). Used where the asserted
 * behaviour is local (the sweep, the reserved interval) and must not wait for sales to cancel.
 *
 * TODO: switch to `POST leases/{id}/end` with a held cancel operation once sales recurring orders
 * Phases 2–3 land and the end is no longer refused with `lease_billing_cancel_unavailable`.
 */
export async function pinPendingEnd(leaseId: string, changeId: string, endsOn: string): Promise<number> {
  return withClient(async (client) => {
    await client.query('begin')
    try {
      const current = await client.query<PinnedLeaseRow>(
        `select ends_on::text as ends_on, starts_on::text as starts_on, status, term_months, current_version_id
           from property_management_leases
          where id = $1 and status = 'active'
          for update`,
        [leaseId],
      )
      const row = current.rows[0]
      if (!row) {
        await client.query('rollback')
        return 0
      }
      const pendingChange = buildPendingChange(
        'end',
        changeId,
        previousTermOf({
          endsOn: row.ends_on,
          startsOn: row.starts_on,
          status: row.status,
          termMonths: row.term_months,
          currentVersionId: row.current_version_id,
        }),
        [],
      )
      const pinned = await client.query(
        `update property_management_leases set ends_on = $1, pending_change = $2::jsonb where id = $3 and status = 'active'`,
        [endsOn, JSON.stringify(pendingChange), leaseId],
      )
      await client.query('commit')
      return pinned.rowCount ?? 0
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

type PinnedLeaseRow = {
  ends_on: string
  starts_on: string
  status: LeaseStatus
  term_months: number
  current_version_id: string | null
}

export async function releasePinnedChange(leaseId: string | null, changeId: string): Promise<void> {
  if (!leaseId) return
  await withClient((client) =>
    client.query(
      `update property_management_leases set pending_change = null where id = $1 and pending_change->>'changeId' = $2`,
      [leaseId, changeId],
    ),
  )
}

/**
 * Releases a pending end pinned by `pinPendingEnd`, then cleans the lease setup up. The rest of the
 * cleanup runs even when the release fails; the release failure is then thrown, so a lease left with
 * a pinned pending change fails the test instead of passing silently.
 */
export async function cleanupPinnedLeaseSetup(
  request: APIRequestContext,
  token: string | null,
  setup: LeaseSetup | null,
  pinned: { leaseId: string | null; changeId: string },
): Promise<void> {
  let releaseFailure: unknown = null
  try {
    await releasePinnedChange(pinned.leaseId, pinned.changeId)
  } catch (error) {
    releaseFailure = error
  }
  try {
    await cleanupLeaseSetup(request, token, setup)
  } finally {
    if (releaseFailure !== null) {
      throw new Error(
        `[internal] releasing the pending change ${pinned.changeId} pinned on lease ${pinned.leaseId} failed: ${firstLineOf(releaseFailure)}`,
        { cause: releaseFailure },
      )
    }
  }
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

export async function runLeaseSweep(scope: { tenantId: string; organizationId: string }): Promise<void> {
  await runSweepQueue(LEASE_SWEEP_QUEUE, scope)
}

export async function runSweepQueue(queueName: string, scope: { tenantId: string; organizationId: string }): Promise<void> {
  const before = await readCompletedCount(queueName)
  const queue = createQueue<{ scope: { tenantId: string; organizationId: string } }>(queueName, 'local', {
    baseDir: QUEUE_BASE_DIR,
    concurrency: 1,
  })
  try {
    await queue.enqueue({ scope })
  } finally {
    await queue.close()
  }
  const drain = await drainQueue(queueName)
  if (drain.ran && drain.processed > 0) return
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await readCompletedCount(queueName)) > before) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  skipOrFailUnsettled(queueName, drain, `the ${queueName} job was not processed although the queue drained`)
}
