/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  dismissRecordConflict,
  getRecordConflictForTest,
  RecordConflictBanner,
  registerRecordLockConflictHandler,
  resetRecordLockConflictHandlerForTest,
} from '@open-mercato/ui/backend/conflicts'
import { ReceivingPanel } from '../backend/components/ReceivingPanel'
import { ReturnLabelPanel } from '../backend/components/ReturnLabelPanel'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn().mockResolvedValue({ ok: true }) }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/ui/backend/utils/apiCall')>(
    '@open-mercato/ui/backend/utils/apiCall',
  )
  return { ...actual, apiCall: jest.fn(), withScopedApiRequestHeaders: jest.fn(actual.withScopedApiRequestHeaders) }
})

const expectedUpdatedAt = '2026-10-25T10:00:00.000Z'
const currentUpdatedAt = '2026-10-25T10:01:00.000Z'
const optimisticConflict = {
  error: 'record_modified',
  code: 'optimistic_lock_conflict',
  expectedUpdatedAt,
  currentUpdatedAt,
}
const recordLockConflict = {
  error: 'Record conflict detected',
  code: 'record_lock_conflict',
  lock: { resourceKind: 'warranty_claims.claim', resourceId: 'claim-1', token: 'test-lock-token' },
  conflict: { id: 'conflict-1', baseActionLogId: 'action-1', incomingActionLogId: 'action-2' },
}
const line: React.ComponentProps<typeof ReceivingPanel>['lines'][number] = {
  id: 'line-1', lineNo: 1, productName: 'Widget', sku: null, serialNumber: null,
  conditionGrade: 'A', quarantineStatus: 'held', inspectionNotes: null, updatedAt: expectedUpdatedAt,
}
const claim: React.ComponentProps<typeof ReturnLabelPanel>['claim'] = {
  id: 'claim-1', status: 'approved', updatedAt: expectedUpdatedAt,
  returnLabelUrl: null, returnTrackingNumber: null, returnCarrier: null,
}

function respond(status: number, result: Record<string, unknown>) {
  jest.mocked(apiCall).mockResolvedValue({ ok: status < 400, status, result, response: new Response(), cacheStatus: null })
}

const panels = [
  {
    name: 'receiving',
    render: (onRefresh: () => Promise<void>) => (
      <ReceivingPanel claimId={claim.id} lines={[line]} canManage receivingCapable onRefresh={onRefresh} />
    ),
    action: 'Release',
    success: { ok: true },
  },
  {
    name: 'return label',
    render: (onRefresh: () => Promise<void>) => (
      <ReturnLabelPanel claim={claim} canManage onRefresh={onRefresh} />
    ),
    action: 'Generate return label',
    success: { status: 'created', labelUrl: null, trackingNumber: 'TRACK-1', carrier: null },
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  dismissRecordConflict()
  resetRecordLockConflictHandlerForTest()
})

afterEach(() => {
  dismissRecordConflict()
  resetRecordLockConflictHandlerForTest()
})

describe.each(panels)('$name conflict recovery', (panel) => {
  it.each([optimisticConflict, recordLockConflict])('surfaces $code with a working refresh action', async (body) => {
    respond(409, body)
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    render(<>{panel.render(onRefresh)}<RecordConflictBanner /></>)

    fireEvent.click(screen.getByRole('button', { name: panel.action }))

    expect(await screen.findByTestId('record-conflict-banner')).toHaveTextContent('Record changed')
    expect(getRecordConflictForTest()?.currentUpdatedAt).toBe(
      body.code === 'optimistic_lock_conflict' ? currentUpdatedAt : null,
    )
    expect(flash).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('record-conflict-banner')).not.toBeInTheDocument()
  })

  it('passes the complete enterprise payload to the registered merge handler', async () => {
    respond(409, recordLockConflict)
    const handler = jest.fn(() => true)
    registerRecordLockConflictHandler(handler)
    render(panel.render(jest.fn().mockResolvedValue(undefined)))

    fireEvent.click(screen.getByRole('button', { name: panel.action }))

    await waitFor(() => expect(handler).toHaveBeenCalledWith(
      recordLockConflict,
      expect.objectContaining({ status: 409, body: recordLockConflict }),
    ))
    expect(getRecordConflictForTest()).toBeNull()
    expect(flash).not.toHaveBeenCalled()
  })

  it('retains ordinary translated API errors', async () => {
    respond(422, { error: 'warranty_claims.errors.invalidInput' })
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    render(panel.render(onRefresh))

    fireEvent.click(screen.getByRole('button', { name: panel.action }))

    await waitFor(() => expect(flash).toHaveBeenCalledWith('warranty_claims.errors.invalidInput', 'error'))
    expect(getRecordConflictForTest()).toBeNull()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('retains successful actions and refreshes the record', async () => {
    respond(200, panel.success)
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    render(panel.render(onRefresh))

    fireEvent.click(screen.getByRole('button', { name: panel.action }))

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(flash).toHaveBeenCalledWith(expect.any(String), 'success')
    expect(getRecordConflictForTest()).toBeNull()
  })
})

it('reopens receiving with the refreshed line version after a grading conflict', async () => {
  respond(409, optimisticConflict)
  const onRefresh = jest.fn().mockResolvedValue(undefined)
  const view = render(
    <>
      <ReceivingPanel claimId={claim.id} lines={[line]} canManage receivingCapable onRefresh={onRefresh} />
      <RecordConflictBanner />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Grade / Receive' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  view.rerender(
    <>
      <ReceivingPanel claimId={claim.id} lines={[{ ...line, updatedAt: currentUpdatedAt }]}
        canManage receivingCapable onRefresh={onRefresh} />
      <RecordConflictBanner />
    </>,
  )
  respond(200, { ok: true })
  fireEvent.click(screen.getByRole('button', { name: 'Grade / Receive' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(apiCall).toHaveBeenLastCalledWith(
    '/api/warranty_claims/receiving',
    expect.objectContaining({ body: JSON.stringify({ lineId: line.id, conditionGrade: 'A', updatedAt: currentUpdatedAt }) }),
  ))
  expect(withScopedApiRequestHeaders).toHaveBeenLastCalledWith(
    { 'x-om-ext-optimistic-lock-expected-updated-at': currentUpdatedAt }, expect.any(Function),
  )
})
