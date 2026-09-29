/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const mockTranslate = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: { label: string; action?: React.ReactNode }) => <div role="alert">{label}{action}</div>,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => <div data-testid="dialog-content" onKeyDown={onKeyDown}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

import { LinkDocumentDialog } from '../widgets/injection/related-documents/LinkDocumentDialog'
import { useRelatedDocuments } from '../widgets/injection/related-documents/useRelatedDocuments'

const TARGET = {
  entityType: 'customer-company' as const,
  entityId: '11111111-1111-4111-8111-111111111111',
  label: 'Acme',
  href: '/backend/customers/companies/11111111-1111-4111-8111-111111111111',
  values: { name: 'Acme' },
}
const SECOND_TARGET = {
  ...TARGET,
  entityId: '33333333-3333-4333-8333-333333333333',
  label: 'Globex',
  href: '/backend/customers/companies/33333333-3333-4333-8333-333333333333',
  values: { name: 'Globex' },
}

function documentResult(title: string) {
  return {
    ok: true,
    result: {
      items: [{
        id: '22222222-2222-4222-8222-222222222222',
        title,
        ownerLabel: 'Ada Lovelace',
        capabilities: { canEdit: true },
      }],
    },
  }
}

function viewerOnlyResult(count: number, totalPages: number) {
  return {
    ok: true,
    result: {
      items: Array.from({ length: count }, (_, index) => ({
        id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
        title: `Viewer document ${index}`,
        ownerLabel: 'Ada Lovelace',
        capabilities: { canEdit: false },
      })),
      totalPages,
    },
  }
}

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

describe('LinkDocumentDialog search freshness', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
    apiCallOrThrowMock.mockReset()
    runMutationMock.mockReset()
  })

  afterEach(() => { jest.useRealTimers() })

  it('removes old rows synchronously and aborts the old request when the query changes', async () => {
    let resolveBeta: ((value: unknown) => void) | null = null
    let betaSignal: AbortSignal | undefined
    apiCallMock
      .mockResolvedValueOnce(documentResult('Alpha document'))
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        betaSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveBeta = resolve })
      })

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={jest.fn()} onLinked={jest.fn()} />)
    const input = screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel')

    fireEvent.change(input, { target: { value: 'alpha' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByText('Alpha document')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'beta' } })
    expect(screen.queryByText('Alpha document')).toBeNull()
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(betaSignal?.aborted).toBe(false)

    fireEvent.change(input, { target: { value: 'gamma' } })
    expect(betaSignal?.aborted).toBe(true)
    await act(async () => {
      resolveBeta?.(documentResult('Stale beta document'))
      await flushPromises()
    })
    expect(screen.queryByText('Stale beta document')).toBeNull()
  })

  it('hides and blocks rows from the previous target context immediately', async () => {
    apiCallMock.mockResolvedValue(documentResult('Context document'))
    const props = { open: true, onOpenChange: jest.fn(), onLinked: jest.fn() }
    const { rerender } = render(<LinkDocumentDialog {...props} target={TARGET} />)
    const input = screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel')

    fireEvent.change(input, { target: { value: 'context' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    const oldRow = screen.getByRole('button', { name: /Context document/ })

    rerender(<LinkDocumentDialog {...props} target={{ ...TARGET, entityId: '33333333-3333-4333-8333-333333333333' }} />)
    expect(screen.queryByText('Context document')).toBeNull()
    fireEvent.click(oldRow)
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('supports Escape and Cmd/Ctrl+Enter for dialog actions', async () => {
    const onOpenChange = jest.fn()
    const onLinked = jest.fn()
    apiCallMock.mockResolvedValue(documentResult('Keyboard document'))
    apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { id: 'link-id' } })
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={onOpenChange} onLinked={onLinked} />)
    fireEvent.change(screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel'), { target: { value: 'keyboard' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    fireEvent.keyDown(screen.getByTestId('dialog-content'), { key: 'Enter', metaKey: true })
    await act(async () => { await flushPromises() })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(onLinked).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByTestId('dialog-content'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps paginating when the first page holds no editable matches', async () => {
    apiCallMock
      .mockResolvedValueOnce(viewerOnlyResult(20, 2))
      .mockResolvedValueOnce({
        ok: true,
        result: {
          items: [{
            id: '55555555-5555-4555-8555-555555555555',
            title: 'Editable document',
            ownerLabel: 'Ada Lovelace',
            capabilities: { canEdit: true },
          }],
          totalPages: 2,
        },
      })

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={jest.fn()} onLinked={jest.fn()} />)
    fireEvent.change(screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel'), { target: { value: 'report' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises(12)
    })

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(apiCallMock.mock.calls[0]?.[0]).toContain('page=1')
    expect(apiCallMock.mock.calls[1]?.[0]).toContain('page=2')
    expect(screen.getByText('Editable document')).toBeTruthy()
    expect(screen.queryByText('documents.relatedDocuments.linkDialog.empty')).toBeNull()
  })

  it('reports no editable matches once the paginated results are exhausted', async () => {
    apiCallMock.mockResolvedValue(viewerOnlyResult(1, 1))

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={jest.fn()} onLinked={jest.fn()} />)
    fireEvent.change(screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel'), { target: { value: 'report' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises(12)
    })

    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('documents.relatedDocuments.linkDialog.empty')).toBeTruthy()
  })

  it('renders a distinct search error and retries without showing the empty state', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
      .mockResolvedValueOnce(documentResult('Recovered document'))

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={jest.fn()} onLinked={jest.fn()} />)
    fireEvent.change(screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel'), { target: { value: 'recover' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    expect(screen.getByRole('alert').textContent).toContain('documents.relatedDocuments.linkDialog.error')
    expect(screen.queryByText('documents.relatedDocuments.linkDialog.empty')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'documents.actions.retry' }))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    expect(screen.getByText('Recovered document')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the previous host results synchronously and aborts its in-flight reload', async () => {
    let resolveOldReload: ((value: unknown) => void) | null = null
    let resolveNewTarget: ((value: unknown) => void) | null = null
    let oldReloadSignal: AbortSignal | undefined
    let newTargetSignal: AbortSignal | undefined
    apiCallMock
      .mockResolvedValueOnce(documentResult('Acme private document'))
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        oldReloadSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveOldReload = resolve })
      })
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        newTargetSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveNewTarget = resolve })
      })

    const { result, rerender } = renderHook(
      ({ target }) => useRelatedDocuments(target),
      { initialProps: { target: TARGET } },
    )
    await act(async () => { await flushPromises() })
    expect(result.current.items.map((item) => item.title)).toEqual(['Acme private document'])

    act(() => { result.current.retry() })
    await act(async () => { await flushPromises() })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(oldReloadSignal?.aborted).toBe(false)

    rerender({ target: SECOND_TARGET })
    await act(async () => { await flushPromises() })

    expect(oldReloadSignal?.aborted).toBe(true)
    expect(newTargetSignal?.aborted).toBe(false)
    expect(result.current.status).toBe('loading')
    expect(result.current.items).toEqual([])
    expect(result.current.capabilities).toEqual(expect.objectContaining({ canCreateDocument: false }))

    await act(async () => {
      resolveOldReload?.(documentResult('Stale Acme document'))
      await flushPromises()
    })
    expect(result.current.items).toEqual([])

    await act(async () => {
      resolveNewTarget?.(documentResult('Globex document'))
      await flushPromises()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.items.map((item) => item.title)).toEqual(['Globex document'])
  })
})
