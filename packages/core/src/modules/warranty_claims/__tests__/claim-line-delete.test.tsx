/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import WarrantyClaimDetailPage from '../backend/warranty_claims/[id]/page'
import enDict from '../i18n/en.json'

const mockConfirm = jest.fn()
const mockApiCall = jest.fn()
const mockReadApiResult = jest.fn()
const mockDeleteCrud = jest.fn()
const mockRetry = jest.fn(async () => true)
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  withScopedApiRequestHeaders: jest.fn(async (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation()),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ deleteCrud: (...args: unknown[]) => mockDeleteCrud(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: mockRetry }),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({ useCurrentUserId: () => 'user-1' }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useCurrentOrganization: () => null }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => null }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, rowActions }: {
    data: Array<{ id: string; productName: string }>
    rowActions?: (line: { id: string; productName: string }) => React.ReactNode
  }) => <div>{data.map((line) => <div key={line.id} data-testid={line.id}>{line.productName}{rowActions?.(line)}</div>)}</div>,
}))
jest.mock('../backend/components/ReceivingPanel', () => ({ ReceivingPanel: () => null }))
jest.mock('../backend/components/ReturnLabelPanel', () => ({ ReturnLabelPanel: () => null }))
jest.mock('../backend/components/VendorRecoverySuggestionsPanel', () => ({ VendorRecoverySuggestionsPanel: () => null }))
jest.mock('../backend/components/useUserDisplayNames', () => ({ useUserDisplayNames: () => ({}) }))

const LINE_VERSION = '2026-10-27T10:00:00.000Z'
const claim = {
  id: 'claim-1',
  claimNumber: 'RET-000001',
  claimType: 'return',
  status: 'draft',
  currencyCode: 'USD',
  updatedAt: '2026-10-27T11:00:00.000Z',
}
const line = {
  id: 'line-1',
  claimId: claim.id,
  lineNo: 1,
  productName: 'Wrong item',
  qtyClaimed: '1',
  lineStatus: 'pending',
  updatedAt: LINE_VERSION,
}

function setup({ status = 'draft', features = ['warranty_claims.claim.manage'] } = {}) {
  let deleted = false
  mockApiCall.mockResolvedValue({ ok: true, result: { ok: false, granted: features } })
  mockReadApiResult.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/warranty_claims?')) return { items: [{ ...claim, status }] }
    if (String(url).startsWith('/api/warranty_claims/lines?')) return { items: deleted ? [] : [line] }
    return { items: [] }
  })
  mockDeleteCrud.mockImplementation(async () => {
    deleted = true
    return { ok: true }
  })
  return renderWithProviders(<WarrantyClaimDetailPage params={{ id: claim.id }} />, { dict: enDict })
}

async function openRemoveAction() {
  const row = await screen.findByTestId(line.id)
  fireEvent.click(within(row).getByRole('button', { name: 'Open actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove line' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
  jest.mocked(surfaceRecordConflict).mockReturnValue(false)
})

describe('claim line deletion from the desk (#8012)', () => {
  it('confirms and deletes the selected line with its own version, then reloads the desk', async () => {
    setup()
    await openRemoveAction()

    await waitFor(() => expect(mockDeleteCrud).toHaveBeenCalledWith('warranty_claims/lines', {
      body: { id: line.id, claimId: claim.id },
      errorMessage: enDict['warranty_claims.detail.lines.error.delete'],
    }))
    expect(mockConfirm).toHaveBeenCalledWith({ title: 'Remove line', variant: 'destructive' })
    expect(withScopedApiRequestHeaders).toHaveBeenCalledWith({
      'x-om-ext-optimistic-lock-expected-updated-at': LINE_VERSION,
    }, expect.any(Function))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'warranty_claims.claim_line', resourceId: line.id, retryLastMutation: mockRetry,
      }),
      mutationPayload: { id: line.id, claimId: claim.id },
    }))
    await waitFor(() => expect(screen.queryByTestId(line.id)).toBeNull())
    expect(flash).toHaveBeenCalledWith(enDict['warranty_claims.detail.lines.flash.deleted'], 'success')
  })

  it('does not mutate when the confirmation is cancelled', async () => {
    mockConfirm.mockResolvedValue(false)
    setup()
    await openRemoveAction()

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(mockDeleteCrud).not.toHaveBeenCalled()
    expect(screen.getByTestId(line.id)).toBeTruthy()
  })

  it('surfaces stale-version conflicts and keeps the line', async () => {
    setup()
    const conflict = new Error('stale line')
    mockDeleteCrud.mockRejectedValueOnce(conflict)
    jest.mocked(surfaceRecordConflict).mockReturnValue(true)
    await openRemoveAction()

    await waitFor(() => expect(surfaceRecordConflict).toHaveBeenCalledWith(
      conflict, expect.any(Function), { onRefresh: expect.any(Function) },
    ))
    expect(screen.getByTestId(line.id)).toBeTruthy()
    expect(flash).not.toHaveBeenCalled()
  })

  it('shows a failed deletion without removing the line', async () => {
    setup()
    mockDeleteCrud.mockRejectedValueOnce(new Error('Delete failed'))
    await openRemoveAction()

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Delete failed', 'error'))
    expect(screen.getByTestId(line.id)).toBeTruthy()
  })

  it('does not delete when a mutation guard blocks the request', async () => {
    setup()
    mockRunMutation.mockRejectedValueOnce(new Error('Deletion blocked'))
    await openRemoveAction()

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Deletion blocked', 'error'))
    expect(mockDeleteCrud).not.toHaveBeenCalled()
    expect(screen.getByTestId(line.id)).toBeTruthy()
  })

  it.each(['closed', 'cancelled', 'resolved', 'rejected'])('hides line actions for a %s claim', async (status) => {
    setup({ status })
    const row = await screen.findByTestId(line.id)
    expect(within(row).queryByRole('button', { name: 'Open actions' })).toBeNull()
  })

  it('hides line actions without claim.manage permission', async () => {
    setup({ features: ['warranty_claims.claim.view'] })
    const row = await screen.findByTestId(line.id)
    expect(within(row).queryByRole('button', { name: 'Open actions' })).toBeNull()
  })
})
