/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const panelApiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const translate = (key: string) => key

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockVersionPreviewDialog() { return null },
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => false),
  }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/SectionHeader', () => ({
  SectionHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <div><h2>{title}</h2>{action}</div>,
}))
jest.mock('../backend/documents/components/EntityPicker', () => ({
  EntityPicker: ({ onPick }: { onPick: (pick: { type: 'customer-company'; id: string; label: string; href: string }) => void }) => (
    <button type="button" onClick={() => onPick({
      type: 'customer-company',
      id: '22222222-2222-4222-8222-222222222222',
      label: 'Fresh company',
      href: '/backend/customers/companies/22222222-2222-4222-8222-222222222222',
    })}>
      pick-record
    </button>
  ),
}))
jest.mock('../backend/documents/[id]/RecordFieldsDialog', () => ({ RecordFieldsDialog: () => null }))

import { RelatedRecordsPanel } from '../backend/documents/[id]/RelatedRecordsPanel'
import { VersionHistoryPanel } from '../backend/documents/[id]/VersionHistoryPanel'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'
const UPDATED_AT = '2026-07-15T08:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

function relatedRecordsResponse(label: string) {
  return {
    ok: true,
    status: 200,
    result: {
      items: [{
        id: `${label.toLowerCase().replace(/\s+/g, '-')}-link`,
        entityType: 'customer-company',
        label,
        href: null,
        canOpen: false,
        source: 'related-panel',
        updatedAt: UPDATED_AT,
        values: {},
      }],
    },
  }
}

function versionsResponse(label: string) {
  return {
    ok: true,
    status: 200,
    result: {
      items: [{
        id: `${label.toLowerCase().replace(/\s+/g, '-')}-version`,
        label,
        creatorLabel: 'Ada Lovelace',
        createdAt: UPDATED_AT,
      }],
    },
  }
}

describe('document side-panel reload freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockReset()
    panelApiCallMock.mockReset()
    apiCallMock.mockImplementation((path: unknown, ...rest: unknown[]) => (
      typeof path === 'string' && path.includes('entityType=document')
        ? Promise.resolve({ ok: true, status: 200, result: { items: [] } })
        : panelApiCallMock(path, ...rest)
    ))
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 201, result: {} })
  })

  it('aborts and ignores an obsolete related-record load after linking', async () => {
    const staleLoad = deferred<ReturnType<typeof relatedRecordsResponse>>()
    let staleSignal: AbortSignal | undefined
    panelApiCallMock
      .mockImplementationOnce((_path: string, options?: RequestInit) => {
        staleSignal = options?.signal ?? undefined
        return staleLoad.promise
      })
      .mockResolvedValueOnce(relatedRecordsResponse('Fresh company'))

    render(<RelatedRecordsPanel documentId={DOCUMENT_ID} canEdit editor={null} />)
    await waitFor(() => expect(panelApiCallMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'pick-record' }))

    await waitFor(() => expect(screen.getByText('Fresh company')).toBeTruthy())
    expect(staleSignal?.aborted).toBe(true)

    await act(async () => {
      staleLoad.resolve(relatedRecordsResponse('Stale company'))
      await staleLoad.promise
    })
    expect(screen.queryByText('Stale company')).toBeNull()
    expect(screen.getByText('Fresh company')).toBeTruthy()
  })

  it('aborts and ignores an obsolete version load after creating a snapshot', async () => {
    const staleLoad = deferred<ReturnType<typeof versionsResponse>>()
    let staleSignal: AbortSignal | undefined
    panelApiCallMock
      .mockImplementationOnce((_path: string, options?: RequestInit) => {
        staleSignal = options?.signal ?? undefined
        return staleLoad.promise
      })
      .mockResolvedValueOnce(versionsResponse('Fresh snapshot'))

    render(
      <VersionHistoryPanel
        documentId={DOCUMENT_ID}
        canRestore
        contentUpdatedAt={UPDATED_AT}
      />,
    )
    await waitFor(() => expect(panelApiCallMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'documents.versions.actions.snapshot' }))

    await waitFor(() => expect(screen.getByText('Fresh snapshot')).toBeTruthy())
    expect(staleSignal?.aborted).toBe(true)

    await act(async () => {
      staleLoad.resolve(versionsResponse('Stale snapshot'))
      await staleLoad.promise
    })
    expect(screen.queryByText('Stale snapshot')).toBeNull()
    expect(screen.getByText('Fresh snapshot')).toBeTruthy()
  })

  it('does not let a completed mutation for the previous document abort the current related-record load', async () => {
    const staleMutation = deferred<{ ok: boolean; status: number; result: Record<string, never> }>()
    const currentLoad = deferred<ReturnType<typeof relatedRecordsResponse>>()
    let currentSignal: AbortSignal | undefined
    panelApiCallMock
      .mockResolvedValueOnce(relatedRecordsResponse('Document A company'))
      .mockImplementationOnce((_path: string, options?: RequestInit) => {
        currentSignal = options?.signal ?? undefined
        return currentLoad.promise
      })
    apiCallOrThrowMock.mockImplementationOnce(() => staleMutation.promise)

    const { rerender } = render(<RelatedRecordsPanel documentId={DOCUMENT_ID} canEdit editor={null} />)
    await waitFor(() => expect(screen.getByText('Document A company')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'pick-record' }))
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))

    rerender(<RelatedRecordsPanel documentId={OTHER_DOCUMENT_ID} canEdit editor={null} />)
    await waitFor(() => expect(panelApiCallMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Document A company')).toBeNull())
    expect(currentSignal?.aborted).toBe(false)

    await act(async () => {
      staleMutation.resolve({ ok: true, status: 201, result: {} })
      await staleMutation.promise
      await flushPromises()
    })
    expect(panelApiCallMock).toHaveBeenCalledTimes(2)
    expect(currentSignal?.aborted).toBe(false)
    expect(screen.queryByText('Document A company')).toBeNull()

    await act(async () => {
      currentLoad.resolve(relatedRecordsResponse('Document B company'))
      await currentLoad.promise
    })
    await waitFor(() => expect(screen.getByText('Document B company')).toBeTruthy())
    expect(screen.queryByText('Document A company')).toBeNull()
  })

  it('does not let a completed mutation for the previous document abort the current version load', async () => {
    const staleMutation = deferred<{ ok: boolean; status: number; result: Record<string, never> }>()
    const currentLoad = deferred<ReturnType<typeof versionsResponse>>()
    let currentSignal: AbortSignal | undefined
    panelApiCallMock
      .mockResolvedValueOnce(versionsResponse('Document A snapshot'))
      .mockImplementationOnce((_path: string, options?: RequestInit) => {
        currentSignal = options?.signal ?? undefined
        return currentLoad.promise
      })
    apiCallOrThrowMock.mockImplementationOnce(() => staleMutation.promise)

    const { rerender } = render(
      <VersionHistoryPanel documentId={DOCUMENT_ID} canRestore contentUpdatedAt={UPDATED_AT} />,
    )
    await waitFor(() => expect(screen.getByText('Document A snapshot')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'documents.versions.actions.snapshot' }))
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))

    rerender(
      <VersionHistoryPanel documentId={OTHER_DOCUMENT_ID} canRestore contentUpdatedAt={UPDATED_AT} />,
    )
    await waitFor(() => expect(panelApiCallMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Document A snapshot')).toBeNull())
    expect(currentSignal?.aborted).toBe(false)

    await act(async () => {
      staleMutation.resolve({ ok: true, status: 201, result: {} })
      await staleMutation.promise
      await flushPromises()
    })
    expect(panelApiCallMock).toHaveBeenCalledTimes(2)
    expect(currentSignal?.aborted).toBe(false)
    expect(screen.queryByText('Document A snapshot')).toBeNull()

    await act(async () => {
      currentLoad.resolve(versionsResponse('Document B snapshot'))
      await currentLoad.promise
    })
    await waitFor(() => expect(screen.getByText('Document B snapshot')).toBeTruthy())
    expect(screen.queryByText('Document A snapshot')).toBeNull()
  })
})
