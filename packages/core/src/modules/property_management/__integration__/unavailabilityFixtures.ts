import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export type ClosureSubject = { subjectType: 'building' | 'floor' | 'space' | 'unit'; subjectId: string }

export type ClosureInput = ClosureSubject & {
  startsAt: string
  endsAt?: string | null
  reasonText?: string
  reasonEntryId?: string | null
  previewToken?: string
}

export type ClosurePreview = {
  unitCount: number
  bookingsToCancel: Array<{ id: string; unitId: string; startsAt: string }>
  bookingCount: number
  leasesToFlag: Array<{ id: string; reference: string }>
  leaseCount: number
  previewToken: string
}

export type ClosureRow = {
  id: string
  subjectType: string
  subjectId: string
  reasonText: string
  inEffect: boolean
  effectiveEndsAt: string | null
  cancelledBookingCount: number
  applyStatus: 'applied' | 'applying'
}

export async function postClosure(request: APIRequestContext, token: string, input: ClosureInput, dryRun: boolean) {
  return apiRequest(request, 'POST', `/api/property_management/unavailabilities?dryRun=${dryRun ? 'true' : 'false'}`, {
    token,
    data: { reasonText: 'QA renovation', ...input },
  })
}

export async function previewClosure(request: APIRequestContext, token: string, input: ClosureInput): Promise<ClosurePreview> {
  const response = await postClosure(request, token, input, true)
  const body = await readJsonSafe<ClosurePreview>(response)
  expect(response.status(), `dry run → ${JSON.stringify(body)}`).toBe(200)
  expect(body?.previewToken).toBeTruthy()
  return body as ClosurePreview
}

export async function confirmClosure(
  request: APIRequestContext,
  token: string,
  input: ClosureInput,
  closureIds: string[],
): Promise<{ id: string; cancelledBookings: number; flaggedLeases: number }> {
  const preview = await previewClosure(request, token, input)
  const response = await postClosure(request, token, { ...input, previewToken: preview.previewToken }, false)
  const body = await readJsonSafe<{ id?: string; cancelledBookings?: number; flaggedLeases?: number }>(response)
  expect(response.status(), `confirm → ${JSON.stringify(body)}`).toBe(201)
  const id = expectId(body?.id, 'Unavailability id')
  closureIds.push(id)
  return { id, cancelledBookings: body?.cancelledBookings ?? 0, flaggedLeases: body?.flaggedLeases ?? 0 }
}

export async function endClosure(request: APIRequestContext, token: string, closureId: string) {
  return apiRequest(request, 'POST', `/api/property_management/unavailabilities/${closureId}/end`, { token })
}

export async function endClosures(request: APIRequestContext, token: string | null, closureIds: readonly string[]): Promise<void> {
  if (!token) return
  for (const id of closureIds) await endClosure(request, token, id).catch(() => undefined)
}

export async function listClosures(request: APIRequestContext, token: string, buildingId: string): Promise<ClosureRow[]> {
  const response = await apiRequest(request, 'GET', `/api/property_management/unavailabilities?buildingIds=${buildingId}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ items?: ClosureRow[] }>(response))?.items ?? []
}

export async function readSlots(request: APIRequestContext, token: string, unitId: string, date: string) {
  const response = await apiRequest(request, 'GET', `/api/property_management/units/${unitId}/slots?date=${date}`, { token })
  const body = await readJsonSafe<{ openingHours: Array<{ start: string; end: string }> | null; slots: Array<{ start: string; end: string; state: string }> }>(response)
  expect(response.status(), `GET slots → ${JSON.stringify(body)}`).toBe(200)
  return body as NonNullable<typeof body>
}

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}
